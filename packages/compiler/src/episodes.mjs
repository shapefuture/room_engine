// Episode segmentation for room-of-us.
//
// Two-pass TextTiling port of B's embed/room-of-us/compiler/src/episodes.py
// (MERGE_PLAN.md §3). Pass 1 places boundaries on temporal gaps weighted by
// topical continuity (with reply-thread stickiness). Pass 2 splits long
// uninterrupted bursts (> MAX_EPISODE) at cohesion valleys so a marathon night
// still yields separate, citable units.
//
// Unlike B, pass 1 uses the shared stopword-filtering `tokens()` from
// packages/shared/src/tokens.mjs (intended deviation, MERGE_PLAN §3.1).
//
// The Episode output shape is byte-for-byte the shape compile.mjs produced
// inline, so downstream cartridge assembly and the UI are untouched:
//   {id,start,end,participants,message_ids,representative,themes,summary,status}
//
// Exports:
//   makeEpisodes(messages, tokensFn)  -> Episode[]   (segmentation entry point)
//   makeEpisode(messages, index)      -> Episode     (per-chunk builder)
//   computeBoundaries(messages, tokensFn) -> number[] (pass 1, exposed for tests)
//   cohesionSplits(messages, s, e, tokensFn) -> number[] (pass 2, exposed for tests)

import { tokens } from '../../shared/src/tokens.mjs';

export const HARD_GAP = 6 * 3600; // 21600s: a gap this long is a boundary alone
export const SOFT_GAP = 12 * 60;  // 720s: below this, same breath
export const WINDOW = 6;          // messages each side for lexical continuity
export const MAX_EPISODE = 60;    // above this we look for internal topic seams
export const BLOCK = 10;          // messages per cohesion block
export const CUT_SD = 0.55;       // cutoff = mean - CUT_SD * population sd
export const SLIVER = 15;         // never carve out a chunk smaller than this

// Cosine overlap of two type-sets (the lexical-continuity signal).
function lexicalOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const w of small) if (big.has(w)) inter++;
  return inter / Math.sqrt(a.size * b.size);
}

function vocabOf(messages, from, to, tokensFn) {
  const set = new Set();
  for (let i = from; i < to; i++) for (const w of (messages[i]._toks ?? tokensFn(messages[i].text))) set.add(w);
  return set;
}

// Pass 1: temporal boundaries, weighted against topical continuity.
export function computeBoundaries(messages, tokensFn = tokens) {
  const out = [0];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const cur = messages[i];
    const gap = cur.t - prev.t;
    if (gap >= HARD_GAP) { out.push(i); continue; }
    if (gap < SOFT_GAP) continue;
    // A reply into the recent past keeps the thread alive.
    if (cur.r != null && cur.r >= messages[Math.max(0, i - WINDOW)].seq) continue;
    // Otherwise weigh a medium gap against topical continuity.
    const back = vocabOf(messages, Math.max(0, i - WINDOW), i, tokensFn);
    const fwd = vocabOf(messages, i, Math.min(messages.length, i + WINDOW), tokensFn);
    const cont = lexicalOverlap(back, fwd);
    const gapScore = Math.min(1, gap / HARD_GAP);
    if ((gapScore > 0.18 && cont < 0.22) || gapScore > 0.45) out.push(i);
  }
  out.push(messages.length);
  return out;
}

// Pass 2: cohesion valleys inside a single (s,e) span.
export function cohesionSplits(messages, s, e, tokensFn = tokens) {
  const blocks = [];
  for (let i = s; i < e;) {
    const j = Math.min(i + BLOCK, e);
    blocks.push([i, j, vocabOf(messages, i, j, tokensFn)]);
    i = j;
  }
  if (blocks.length < 3) return [];

  const scores = [];
  for (let b = 1; b < blocks.length; b++) {
    const left = new Set(blocks[b - 1][2]);
    if (b >= 2) for (const w of blocks[b - 2][2]) left.add(w);
    const right = new Set(blocks[b][2]);
    if (b + 1 < blocks.length) for (const w of blocks[b + 1][2]) right.add(w);
    scores.push([lexicalOverlap(left, right), blocks[b][0]]);
  }
  if (!scores.length) return [];

  const vals = scores.map((x) => x[0]);
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  const cutoff = mean - CUT_SD * sd;

  const cuts = [];
  let last = s;
  for (const [v, idx] of scores) {
    // Valleys only, and never carve out a sliver.
    if (v <= cutoff && idx - last >= SLIVER && e - idx >= SLIVER) { cuts.push(idx); last = idx; }
  }
  return cuts;
}

// Build one Episode from a chunk. Preserves compile.mjs's exact output shape
// (theme selection top-8 token counts, representative top-5 by salience,
// summary template).
export function makeEpisode(messages, index) {
  const counts = new Map();
  for (const m of messages) for (const t of (m._toks ?? tokens(m.text))) counts.set(t, (counts.get(t) || 0) + 1);
  const themes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
  const rep = [...messages].sort((a, b) => b.salience - a.salience).slice(0, 5).map((x) => x.seq);
  return {
    id: `E${String(index).padStart(4, '0')}`,
    start: messages[0].t,
    end: messages.at(-1).t,
    participants: [...new Set(messages.map((x) => x.p))],
    message_ids: messages.map((x) => x.seq),
    representative: rep,
    themes,
    summary: messages.length === 1 ? messages[0].text : `${messages.length} messages across ${Math.round((messages.at(-1).t - messages[0].t) / 60)} min; themes: ${themes.slice(0, 5).join(', ')}`,
    status: 'DERIVED',
  };
}

export function makeEpisodes(messages, tokensFn = tokens) {
  if (!messages.length) return [];
  const boundaries = computeBoundaries(messages, tokensFn);

  // Second pass: a long uninterrupted burst is not one episode. Split it at
  // cohesion valleys so topic changes inside a marathon still cite separately.
  const refined = new Set([0]);
  for (let k = 0; k < boundaries.length - 1; k++) {
    const s = boundaries[k];
    const e = boundaries[k + 1];
    if (e - s > MAX_EPISODE) for (const cut of cohesionSplits(messages, s, e, tokensFn)) refined.add(cut);
    refined.add(e);
  }
  const sorted = [...refined].sort((a, b) => a - b);

  const episodes = [];
  for (let k = 0; k < sorted.length - 1; k++) {
    const s = sorted[k];
    const e = sorted[k + 1];
    if (e <= s) continue;
    episodes.push(makeEpisode(messages.slice(s, e), episodes.length));
  }
  return episodes;
}
