import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileTelegram} from '../src/compile.mjs';
import {verifyCartridge} from '../../shared/src/runtime-core.mjs';

// Drives the Python echo stage (tools/embed_cpu.py) end-to-end on synthetic
// cartridges. The stage is a faithful port of B's discover.py:842-993 and only
// fires when a vector backend carries semantics; the EMBED_MOCK hash backend has
// none, so these tests inject episode vectors through the ECHO_VEC_FILE hook.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PY = process.env.PYTHON || 'python3';
// tools/free_embeddings.py mock backend: h[:16] (16 bytes) then `base * 6`
// (Python list repetition) => 96 floats. Overrides must match this width so the
// evidence matmul (MV @ episode_vector) is dimensionally valid.
const DIM = 96;
const DAY = 86400;

// --- synthetic corpus ------------------------------------------------------
const WORDS_A = ['галактика', 'телескоп', 'орбита', 'астрономия', 'космонавт'];
const WORDS_B = ['скрипка', 'симфония', 'концерт', 'мелодия', 'музыкант'];
const FILLER = [
  ['квантовый', 'частица', 'энергия', 'фотон', 'плазма'],
  ['пирамида', 'фараон', 'папирус', 'сфинкс', 'династия'],
  ['вулкан', 'магма', 'кратер', 'лавовый', 'пепел'],
];

// Long, unambiguous topic messages (>60 stripped chars so they qualify as
// evidence candidates).
function topicMsgs(words, n) {
  const line = `${words.join(' ')} ${words.join(' ')}`;
  return Array.from({length: n}, (_, i) => `${words[i % words.length]} ${line}`);
}
const fillerMsgs = (words, n) => Array.from({length: n}, (_, i) => `${words[i % words.length]} ${words[i % words.length]}`);

// Each spec: {gapBefore, msgs}; the gap to the previous episode's last message
// must exceed 10800s for makeEpisodes to cut (=> separate episodes).
function buildChat(specs) {
  const messages = [];
  let id = 1000, t = 1_700_000_000, prevEnd = null;
  for (const spec of specs) {
    if (prevEnd != null) t = prevEnd + spec.gapBefore;
    let last = t;
    for (const text of spec.msgs) {
      messages.push({id: id++, date_unixtime: String(t), from: id % 2 ? 'Viktor' : 'Friend', from_id: id % 2 ? 'u1' : 'u2', text});
      last = t; t += 60;
    }
    prevEnd = last;
  }
  return {name: 'Echo', type: 'personal_chat', id: 77, messages};
}

// Episodes 0 and 1 are the echo candidates (near-identical vectors); the rest
// are orthogonal fillers. All cover DIM=16 so the override matches mock width.
function vectorMap(eps, targetWords) {
  const map = {};
  const basis = i => { const v = new Array(DIM).fill(0); v[i] = 1; return v; };
  map[`episode:${eps[0].id}`] = basis(0);
  const nearB = new Array(DIM).fill(0); nearB[0] = 0.99; nearB[1] = 0.1;
  map[`episode:${eps[1].id}`] = nearB;
  for (let k = 2; k < eps.length; k++) map[`episode:${eps[k].id}`] = basis(k % DIM);
  return {map, targetWords};
}

function corpus({targetGap, sameWords}) {
  const b = sameWords ? topicMsgs(WORDS_A, 12) : topicMsgs(WORDS_B, 12);
  return [
    {gapBefore: 0, msgs: topicMsgs(WORDS_A, 12)},
    {gapBefore: targetGap, msgs: b},
    {gapBefore: 20000, msgs: fillerMsgs(FILLER[0], 12)},
    {gapBefore: 20000, msgs: fillerMsgs(FILLER[1], 12)},
    {gapBefore: 20000, msgs: fillerMsgs(FILLER[2], 12)},
    {gapBefore: 20000, msgs: ['ок да']},
    {gapBefore: 20000, msgs: ['ага хм']},
    {gapBefore: 20000, msgs: ['ну да']},
  ];
}

// Compile -> write cartridge -> inject vectors -> run the enrichment stage.
async function enrich(chat) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-test-'));
  const {cartridge} = await compileTelegram(chat);
  const cartridgePath = path.join(dir, 'cartridge.json');
  fs.writeFileSync(cartridgePath, JSON.stringify(cartridge, null, 2));
  const {map} = vectorMap(cartridge.tier1.episodes);
  const vecPath = path.join(dir, 'vectors.json');
  fs.writeFileSync(vecPath, JSON.stringify(map));
  const env = {...process.env, EMBED_MOCK: '1', ECHO_VEC_FILE: vecPath};
  delete env.SILICONFLOW_KEY; delete env.NVIDIA_NIM_KEY; delete env.GEMINI_KEY; delete env.LOCAL_ONLY;
  execFileSync(PY, ['tools/embed_cpu.py', cartridgePath], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit']});
  return {cartridge: JSON.parse(fs.readFileSync(cartridgePath, 'utf8')), dir};
}

const echoesOf = c => c.tier0.discoveries.filter(d => d.type === 'echo');

test('echo: distant episodes sharing a topic but not words produce an echo', async () => {
  const {cartridge} = await enrich(buildChat(corpus({targetGap: 10 * DAY, sameWords: false})));
  const eps = cartridge.tier1.episodes;
  assert.ok(eps.length >= 8, `expected >=8 episodes, got ${eps.length}`);

  const echoes = echoesOf(cartridge);
  assert.ok(echoes.length >= 1, 'expected at least one echo discovery');
  const e = echoes[0];
  assert.equal(e.type, 'echo');
  assert.ok(e.meta.similarity >= 0.55, `similarity ${e.meta.similarity} >= 0.55`);
  assert.ok(e.meta.lexical_overlap <= 0.22, `lexical_overlap ${e.meta.lexical_overlap} <= 0.22`);
  assert.equal(e.status, 'DERIVED');
  assert.deepEqual(e.episodes, [0, 1]);
  assert.ok(Array.isArray(e.evidence) && e.evidence.length >= 1 && e.evidence.length <= 8,
    `evidence length ${e.evidence?.length} in [1,8]`);

  const seqs = new Set(cartridge.tier1.messages.map(m => m.seq));
  for (const s of e.evidence) assert.ok(seqs.has(s), `evidence seq ${s} references a real message`);

  // reseal recomputed integrity (evidence_records/semantic_candidates/content_manifest)
  await verifyCartridge(cartridge);
});

test('echo: adjacent episodes (gap < 5 days) never echo', async () => {
  const {cartridge} = await enrich(buildChat(corpus({targetGap: 20000, sameWords: false})));
  assert.equal(echoesOf(cartridge).length, 0);
  await verifyCartridge(cartridge);
});

test('echo: identical-word episodes (jaccard > 0.22) never echo', async () => {
  const {cartridge} = await enrich(buildChat(corpus({targetGap: 10 * DAY, sameWords: true})));
  assert.equal(echoesOf(cartridge).length, 0);
  await verifyCartridge(cartridge);
});

test('echo: deterministic echo blocks across runs', async () => {
  const chat = buildChat(corpus({targetGap: 10 * DAY, sameWords: false}));
  const a = echoesOf((await enrich(chat)).cartridge);
  const b = echoesOf((await enrich(chat)).cartridge);
  assert.ok(a.length >= 1);
  assert.deepEqual(a, b);
});
