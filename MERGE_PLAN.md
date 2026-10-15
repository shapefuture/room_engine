# MERGE PLAN — best-of-both: `room-of-us` (A) × `embed/` (B)

> STATUS: **EXECUTED (all lanes implemented, nothing deferred) — final verification in QA_REPORT.md Addendum 2.**
> M7 realized as worker-parallel compile (8× on the real archive, byte-identical manifests). M8 rejected (zero-dep invariant).
> Baseline: our repo at `/Users/viktor/Downloads/kristina maskot/room-of-us/` (post-audit, post-real-archive run).
> Donor: `/Users/viktor/Downloads/kristina maskot/embed/` (gcfc Rust converter + Python/Phaser room-of-us + gcf-ref spec).
> Sources for all algorithm specs below: extraction reports against B's code (file:line refs given) — verified, not guessed.

---

## 0. Executive summary

Adopt from B, into A, without weakening A's non-negotiables (fail-closed integrity, honest QA, zero runtime deps, PWA):

| # | Feature (from B) | Value | Effort | Lane |
|---|---|---|---|---|
| M1 | **Echo discovery engine** (embedding pairwise episode similarity, dual filter sim≥0.55 ∧ Jaccard≤0.22) | High | Med | L1 |
| M2 | **Gries DP background-word model + Snowball-RU stemmer** (feeds M1 + improves search recall) | High | Med | L1 |
| M3 | **TextTiling episode segmentation upgrade** (replaces our gap+80-count heuristic) | Med | Low | L1 |
| M4 | **idx/map sidecar artifacts + byte-range (chunked) message loading** (kills the 129MB monolith boot) | High | High | L2 |
| M5 | **`gcf-pack-root-v1` content-root integrity** (spec §1387-1433) on sidecars | Med | Low | L2 |
| M6 | **Truncation recovery semantics** (`truncated=true` header, salvage complete records) | Med | Low | L3 |
| M7 | Rust compiler (gcfc) as optional backend | Low (we're 5.5min/242k — acceptable) | High | **DEFERRED** (spike only) |
| M8 | Phaser + DOM overlay UI | — | — | **REJECTED** (our canvas+DOM panels already equivalent; adds a 4.2 dep — violates zero-dep) |

**Not adopted from B, ever** (documented as anti-goals): numeric door gate, unverifiable `source_sha256` theater, escape-hatch tests, per-class hard caps without diversity.

---

## 1. Work decomposition — subagent lanes

Principles: (a) parallel lanes MUST have disjoint **write scopes**; (b) every lane names a validation owner and acceptance commands; (c) single integration phase at the end, run by ONE agent (orchestrator) to avoid merge races.

```
Phase 0 (parallel, 3 lanes)          Phase 1 (parallel, 2 lanes)         Phase 2 (serial)
┌──────────────────────────┐
│ L1a fixer-alg-1: stem.mjs│
│      + background.mjs    │──┐
│ L1b fixer-alg-2:         │  │   ┌──────────────────────────┐
│      episodes.mjs        │  ├──>│ L2 fixer-echo:           │
├──────────────────────────┤  │   │      echo stage in       │    ┌─────────────────────┐
│ L3 fixer-fmt: idx/map    │──┼──>│      embed_cpu.py        │───>│ INTEGRATION         │
│      emitters + packroot │  │   ├──────────────────────────┤    │ (orchestrator)      │
│      (shared/src)        │  └──>│ L4 fixer-runtime:        │───>│ compile+verify+QA   │
└──────────────────────────┘      │      chunked boot        │    └─────────────────────┘
```

| Lane | Subagent | Writes (exact) | Depends on |
|---|---|---|---|
| L1a | @fixer #1 | `packages/compiler/src/stem.mjs`, `packages/compiler/src/background.mjs`, `packages/compiler/test/stem.test.mjs`, `packages/compiler/test/background.test.mjs` | — |
| L1b | @fixer #2 | `packages/compiler/src/episodes.mjs`, `packages/compiler/test/episodes.test.mjs` | — |
| L3 | @fixer #3 | `packages/shared/src/gcf-sidecar.mjs` (+ `.d.mts`), `packages/shared/test/gcf-sidecar.test.mjs`, `tools/verify-sidecar.mjs`, `package.json` (scripts only) | — |
| L2 | @fixer #4 | `tools/embed_cpu.py` (echo stage), `tools/reseal-cartridge.mjs` (no-op-compatible extension), `packages/compiler/test/echo.test.mjs` | L1a |
| L4 | @designer→@fixer #5 | `packages/shared/src/runtime-core.mjs` (+ `.d.mts`), `apps/room/src/main.ts` (boot path only) | L3 |
| INT | orchestrator | `packages/compiler/src/compile.mjs` (wire episodes.mjs), gauntlet, README, QA_REPORT, recompile real archive | L1b, L2, L4 |

**Conflict rule:** `compile.mjs`, `main.ts`, `runtime-core.mjs` are touched by at most ONE lane each (listed above); `package.json` only L3 (scripts) and INT (nothing) — L3's edit is additive keys only.

---

## 2. LANE L1a — `stem.mjs` + `background.mjs` (foundation, pure functions)

### 2.1 File: `packages/compiler/src/stem.mjs`

Port B's `stem.py` EXACTLY (Snowball RU + tiny EN fallback). Spec (B refs: stem.py:14-140):

```js
// Exported: stem(word) -> string, stemRu(word), stemEn(word)
// RULES (exact order, first match wins):
const PERFECTIVE_GERUND=[['в','вши','вшись'],['ив','ивши','ившись','ыв','ывши','ывшись']];
const REFLEXIVE=['ся','сь'];
const ADJECTIVAL=['ее','ие','ые','ое','ей','ий','ый','ой','ем','им','ым','ом','его','ого','ему','ому','их','ых','ую','юю','ая','яя','ое','ей','ий','ый','ой'];
const PARTICIPLE=[['ивш','ывш','ующ'],['ем','нн','вш','ющ','им'],['ивш','ывш','ующ']]; // paired: [adj-triggered]
const VERB=['ила','ыла','ена','ейте','уйте','ите','или','ыли','ей','уй','ил','ыл','им','ым','ен','ило','ыло','ено','ят','ует','уют','ит','ыт','ены','ить','ыть','ишь','у','ю','л','н','ем','a'];
const NOUN=['а','ев','ов','ье','иями','ями','ами','еи','ии','и','ей','ой','ий','ям','ям','ам','ом','о','у','ах','иях','ях','ы','ь','ию','ью','ю','ия','ья','я'];
const DERIVATIONAL=['ост','ость'];
const SUPERLATIVE=['ейш','ейше'];
```

Algorithm (port faithfully):
1. `w=word.toLowerCase().replace(/ё/g,'е')`; if `len<4` return `w`.
2. `rv = index(first vowel)+1` else `len`.
3. Step 1: if PERFECTIVE_GERUND matches (with pre-check: entries in group 2 require stem ending `а` or `я` before dropping) → done step 1. Else: strip REFLEXIVE (if match), then if ADJECTIVAL matches → try PARTICIPLE on result; else try VERB; else NOUN. `_try`: first suffix whose base `len(base)>=rv` wins.
4. Step 2: drop trailing `и` if `len-1>=rv`.
5. Step 3: DERIVATIONAL (one) if `len>=rv`.
6. Step 4: collapse `нн→н`.
7. Step 5: SUPERLATIVE (one), then optional `нн→н`.
8. Step 6: drop trailing `ь`. Return result or original.
9. `stem(w) = /[а-яё]/.test(w) ? stemRu(w) : stemEn(w)`; `stemEn`: strip EN suffixes list (stem.py:117-133: `ational|tional|iveness|fulness|ousness|...` order preserved).

**Acceptance tests** (`packages/compiler/test/stem.test.mjs`) — golden vectors, run `npm test`:
```js
// RU cases (verify against B by running their stem.py once during implementation):
[['позиционные','позиц'],['вирусология','вирусолог'],['прекраснейшая','прекрасн'],
 ['связалась','связа'],['потянутся','потян'],['честь','чес'],['музыка','музык']]
// roundtrip safety: stem(x)===stem(stem(x)) for 100 random fixture tokens
// EN: [['running','run'],['flies','fli'],['happy','happi']]
```
Note: generate exact goldens by executing B's `python3 "/Users/viktor/Downloads/kristina maskot/embed/room-of-us/compiler/src/stem.py"` vectors once (read-only invocation of THEIR file is allowed during planning/implementation of L1a).

### 2.2 File: `packages/compiler/src/background.mjs`

Port B's `Background` (background.py:29-96). Pure JS, no numpy needed (B's is pure Python too).

```js
// Exported: class Background { constructor(tokensPerEpisode /*string[][]*/)
//   dp(word), rankOf(word), rarity(word), isGeneric(word), specificity(word) }
```

Algorithm:
1. Build `epSizes[eid]`, `total[w]`, `epCounts: Map<w, Map<eid,n>>` in one pass. `epSizes[eid]=max(1,len(toks))`.
2. `corpusSize=max(1,Σ epSizes)`; `expected[eid]=epSizes[eid]/corpusSize`.
3. `rank[w]` = index in `total` sorted desc (ties: first-seen order — use stable sort of insertion-ordered entries). `vocab=max(1,rank.size)`.
4. `dp(w)`: `tot=total[w]`; if 0→0; `s=Σ_e |epCounts[w][e]/tot − expected[e]|`; return `s/2`.
5. `isGeneric(w)`: `total<3` → true; `rank<700` → true; else `dp(w)<0.72 && dfFrac(w)>0.20` where `dfFrac=epCounts[w].size/nEpisodes`.
6. `rarity(w)=rank/vocab`; `specificity(w)=dp(w)*Math.log(1+total[w])*(0.35+rarity(w))`.

Constants: `GENERIC_RANK=700`, `DP_FLOOR=0.72`, `DF_CEILING=0.20` (background.py:76-78). Cache `dp` per word (Map).

**Acceptance tests** (`background.test.mjs`):
- 3 synthetic episodes: ep0=[cat,cat,cat,dog], ep1=[cat,cat], ep2=[quantum,cat] → `isGeneric('cat')===true` (rank<700 or dp low+df high), `isGeneric('quantum')===false`, `dp∈[0,1]`, `rarity('quantum')>rarity('cat')`.
- Empty-corpus edge: `new Background([[]])` does not throw; `dp('x')===0`.
- Perf guard: 3,535 episodes × real vocab (run against fixture compile) completes < 2s.

**Lane L1a validation owner:** orchestrator. Commands: `npm test` (new tests) + `npm run verify:fixture` (untouched path must stay green). Effort: ~0.5 day. Rollback: delete 4 files, no other file references them yet.

---

## 3. LANE L1b — `episodes.mjs` (TextTiling segmentation)

### 3.1 New module `packages/compiler/src/episodes.mjs`

Move `makeEpisodes/makeEpisode/boundary` OUT of `compile.mjs` into this module, then upgrade to B's two-pass algorithm (episodes.py:59-164). Keep our `Episode` output shape (`{id,start,end,participants,message_ids,representative,themes,summary,status}`) so downstream (compile.mjs cartridge assembly, UI) is untouched until INT phase.

**Pass 1 — boundaries** (window=6 msgs; `HARD_GAP=21600s`, `SOFT_GAP=720s`):
```
for i>=1: gap=cur.t-prev.t
  if gap>=HARD_GAP → cut
  if gap<SOFT_GAP → continue
  if cur.r!=null && cur.r>=msgs[max(0,i-6)].m → continue        // reply-thread stickiness
  back=∪words(msgs[i-6:i]); fwd=∪words(msgs[i:i+6])
  cont=|back∩fwd|/sqrt(|back||fwd|)                              // cosine overlap of type-set
  gapScore=min(1,gap/HARD_GAP)
  if (gapScore>0.18 && cont<0.22) || gapScore>0.45 → cut
```
`words(m)` = our existing `tokens()` (keep shared tokens.mjs — do NOT adopt B's `[\w']+` regex; ours already handles RU stopwords).

**Pass 2 — cohesion splits** for spans `>MAX_EPISODE(60)`:
```
blocks = chunks of BLOCK=10 msgs; need ≥3 blocks
for b in 1..len-1: left=vocab(blocks[b-1]∪blocks[b-2]), right=vocab(blocks[b]∪blocks[b+1])
  score(b)=lexicalOverlap(left,right)     // same cosine formula
cutoff=mean(scores)−0.55·sd(scores)       // population sd
keep cuts where score<=cutoff && idx−lastCut>=15 && end−idx>=15
```

Constants: `HARD_GAP=21600, SOFT_GAP=720, WINDOW=6, MAX_EPISODE=60, BLOCK=10, CUT_SD=0.55, SLIVER=15` (episodes.py:17-19,59,127-128,153-161).

**Wiring deferred to INT phase** (compile.mjs keeps its current implementation until then — L1b only delivers module + tests; this preserves disjoint write scopes).

**Acceptance tests** (`episodes.test.mjs`):
- Existing fixture sample (5 msgs, big gap) → still 2 episodes (compat).
- Synthetic 30-msg burst with topic switch at msg 15 (disjoint vocab, small gaps <SOFT) → passes 1 find NO cut (gap-gated), but 120-msg stream with vocab shift at 60 → pass 2 splits it.
- Reply-chain: 100 msgs, gap 1500s each, replies referencing 5-back → no cuts.
- Perf: 242k messages → segmentation < 20s (validate on fixture scale in tests; real-scale check in INT).

Effort: ~0.5 day. Rollback: module unreferenced — safe delete.

---

## 4. LANE L3 — sidecar artifacts + pack-root (formats, `shared/`)

### 4.1 New module `packages/shared/src/gcf-sidecar.mjs`

Implements emitter + reader for the two sidecars, wire-compatible with gcfc (so B's artifacts remain readable):

**idx format** (gcfc telegram.rs:542-648):
```
GCF profile=generic tool=gcfc-index
## index
  stride=64
  note=byte offsets into the .gcf, 0-based
## sections [N]{name,first,count,offset,t0,t1}
messages|0|20400|810|1756197039|1759265407
## anchors [M]{m,offset,t}
0|860|1756197039
64|10454|1756399317
```
Rules: `offset` = byte offset of the `## ` section-header line **in the .gcf twin**, captured BEFORE writing it; anchor offsets = `buf.length` at the moment row `m` (m%stride===0) STARTS writing. Sections: name=`messages` (no bucketing initially; keep hook for `y2025m08` buckets).

**map format** (gcfc telegram.rs:649-676):
```
GCF profile=generic tool=gcfc-provenance
## source
  file=result.json
  sha256=<64hex of ORIGINAL export JSON>
## provenance [N]{m,tg,off,len,date}
0|1293862|106|940|2025-08-26T11:30:39
```
`off/len` = byte range of the raw record in the ORIGINAL Telegram JSON (we already compute provenance per message in compile.mjs; byte ranges require recording `raw.indexOf` boundaries — see 4.3 step 4).

**Escaping** — reuse our `quoteScalar` rules; additionally gcfc quotes: `-`,`~`,`^`,`true`,`false`, numeric-like, leading `#`,`@`,`.`, any `|`,`,`, control/C1, leading/trailing space (gcf.rs:124-219). Implement `mustQuoteCell(s)` + property tests vs those classes.

**API:**
```js
export function emitIndex({stride=64, sections, anchors})      // → string
export function emitMap({sourceFile, sourceSha256, rows})      // → string
export function parseIndex(text)   // → {stride, sections[], anchors[]}
export function parseMap(text)     // → {source:{file,sha256}, rows:[{m,tg,off,len,date}]}
```

**pack-root integrity (M5)** — implement `gcf-pack-root-v1` over sidecar rows (SPEC.md:1387-1433, generic §10a header fields):
```js
export function packRoot(rows) {
  // canonical record per row: `${m}|${tg}|${off}|${len}|${date}\n`
  // sort records by unsigned UTF-8 byte order; concatenate; sha256 hex lowercase
  // → `sha256:<64hex>`
}
```
(Collapsed generic adaptation of the symbol/edge record protocol — document the derivation in the module header comment; spec's normative lines are graph-profile, our adaptation hashes provenance rows with identical canonicalization discipline: sort → concat → sha256 → `sha256:` prefix.)

### 4.2 CLI `tools/verify-sidecar.mjs`
```
node tools/verify-sidecar.mjs <cartridge.gcf-prefix>
// reads <p>.gcf, <p>.idx.gcf, <p>.map.gcf
// checks: every section offset lands exactly on a `## ` line; every anchor offset lands exactly on a row start; row counts match; packRoot(map rows) === header `pack_root=` if present; map.sha256 === sha256 of source file if provided
```
Add `package.json` scripts (ONLY additive): `"verify:sidecar": "node tools/verify-sidecar.mjs"`.

### 4.3 Integration point (deferred actual emission to INT/L4)
Producer contract for later phases: compile.mjs (or a new `tools/emit-sidecars.mjs`) will:
1. write `.gcf` twin (exists) while recording section offsets + anchor offsets,
2. record per-message original-JSON byte ranges (needs a boundary pre-scan of `result.json` — port of gcfc `scan_messages` idea: regex-driven top-level `"id":` record starts inside the `messages` array; store in provenance rows),
3. emit `.idx.gcf` + `.map.gcf`, stamp `pack_root` into map header.

**Acceptance tests** (`gcf-sidecar.test.mjs`): emit→parse roundtrip property test (100 random rows); byte-offset precision test (emitted anchor N points at exactly the row line start in a synthetic .gcf buffer); `mustQuoteCell` truth table vs gcfc's rule list; packRoot determinism (same rows shuffled input order → same root). Also: parse B's real `/Users/viktor/Downloads/kristina maskot/embed/result.idx.gcf` (first section row `messages|0|20400|810|...` must parse; anchors[0]==={m:0,offset:860,...}) — cross-implementation conformance.

Effort: ~1 day. Validation: `npm test` + `node tools/verify-sidecar.mjs "/Users/viktor/Downloads/kristina maskot/embed/result"` (against B's artifacts). Rollback: additive files only.

---

## 5. LANE L2 — Echo discovery engine (depends L1a)

### 5.1 Design decision (IMPORTANT)

Echo needs episode vectors. Our compile.mjs is vector-free by design; vectors live in `tools/embed_cpu.py` (numpy + NIM/fastembed). **Therefore echo is implemented as a compile-time ENRICHMENT stage inside `embed_cpu.py`** — the stage that already embeds episodes for `episode_embedding_links`. This is a direct port of B's Python (discover.py:842-993) into the same language, minimal translation risk. Compile pipeline stays deterministic + vector-free; echo appears only when `npm run embed` runs (document this in README). Rejection of alternative (b) (JS echo in compile.mjs reading a vector sidecar): splits vector provenance across two runtimes, complicates reseal; revisit only if echo must exist without enrichment.

### 5.2 Implementation in `tools/embed_cpu.py` (after `_nearest_links` computation, before merge+reseal)

Port EXACTLY (B refs discover.py:842-993; all constants):

```python
ECHO_BIG_MIN      = 12     # episodes with n>=12 msgs (discover.py:865)
ECHO_MIN_EPS      = 6      # skip if len(eps)<6 (:857)
ECHO_MIN_BIG      = 4      # skip if len(big)<4 (:865-868)
ECHO_MIN_GAP      = 432000 # 5 days between episode ends/starts (:878)
ECHO_SIM_MIN      = 0.55   # (:883)
ECHO_JAC_MAX      = 0.22   # (:887)
ECHO_KPIVOT       = 22     # evidence candidate pool per episode (:915)
ECHO_MSG_MIN_LEN  = 60     # stripped msg length >60 (:917)
ECHO_BEST_K       = 3      # best msgs per side (:946)
ECHO_EVIDENCE_CAP = 8      # (:966)
ECHO_LIMIT        = 25     # (:842)
```

Steps (using episode vectors ALREADY computed for episode_embedding_links, unit-normalized):
1. `big=[i for i,e in enumerate(eps) if e['message_ids'] count >= 12]`; guards: `len(eps)>=6`, `len(big)>=4`.
2. `V=ep_vecs[big]`; `S=V@V.T` (already cosine).
3. For all pairs a<b: skip if `eps[big[b]].start - eps[big[a]].end < 432000`; skip if `S[a,b]<0.55`; `jac=jaccard(stems_a, stems_b)` over content words `len>4` (stemmed via L1a `stem.mjs` — invoke through a tiny `node -e` bridge OR re-implement stemmer… **decision:** embed_cpu.py shells out once: `node -e "import{stem}from'./packages/compiler/src/stem.mjs';…"` batch-stemming all episode words in ONE call, cached to JSON — keeps single source of truth); skip if `jac>0.22`; keep `(S[a,b]-jac, S[a,b], jac, big[a], big[b])`.
4. Sort desc by `sim-jac`; greedy select with per-episode usage ≤2; stop at 25.
5. Evidence pool per selected episode: msgs with stripped len>60, sorted by −len, top 22; embed pool texts (strip markers, `[:600]`); per pair pick `argsort(-(MV_a @ vec_b))[:3]` and vice-versa; drop pair if either side empty; `evidence = ev[:8]` (message seqs).
6. Topic: `mid=normalize(va+vb)`; topic = first ≤4 content words (len>5, not background-generic via L1a `background.mjs` bridge call) of the pool msg maximizing `MV[pool]@mid`.
7. Emit discoveries into cartridge `tier0.discoveries` (BEFORE reseal — reseal recomputes evidence_records/semantic_candidates/content_manifest):
```json
{"id":"ECHO_{ia}_{ib}","title":"An echo: <topic> returns","type":"echo","score":<round((sim-jac),3)>,
 "evidence":[...≤8],"status":"DERIVED","episodes":[ia,ib],
 "meta":{"similarity":sim,"lexical_overlap":jac,"days_apart":<int>,"date_a":...,"date_b":...,"topic":"..."}}
```
Cap: total discoveries ≤ 36+8 (echo appended AFTER the 36 class-diverse ones; `integrity.semantic_candidates` recount handled by reseal; keep echo OUT of `selectDiscoveries` cap — they're additive enrichment, like Gemini's).

### 5.3 Runtime type plumbing (this lane, minimal): `apps/room/src/main.ts` is L4-owned → L2 does NOT touch it. Instead INT phase adds `'echo'` to: `Discovery` type union (no — type allows any string already; only filters), `CLASSES` display grouping, Mirror 'EMERGENCE'/'TRANSFER' lens filters (`type==='echo'` added to TRANSFER), evidence renderers read `episodes`/`meta` via existing passthrough. Gauntlet allowed-types list (gauntlet-check.mjs:18) must add `'echo'`. All listed in INT checklist.

### 5.4 Acceptance tests (`packages/compiler/test/echo.test.mjs` — runs the Python stage via child_process on a synthetic cartridge, Node asserts):
- Two synthetic episodes 10 days apart with same-topic different-words text (RU), filler episodes → exactly ≥1 echo with `meta.similarity>=0.55 && meta.lexical_overlap<=0.22`.
- Two adjacent-same-day episodes → no echo (MIN_GAP).
- Identical-word episodes (jac>0.22) → no echo.
- Offline determinism: run with `EMBED_MOCK=1` twice → identical echo block (modulo mock vectors' determinism — hash-based, deterministic).
- Real-archive smoke (INT only): echo count ≥3 on 242k corpus.

Effort: ~1 day. Rollback: echo stage is opt-in (only runs inside embed tool); removing the block restores prior behavior.

---

## 6. LANE L4 — runtime chunked boot (depends L3)

### 6.1 Cartridge sharding format (compile-time, INT emits; L4 defines+consumes)

New optional layout beside the monolith (monolith stays the default/fallback — fail-closed preserved):
```
public/
  cartridge.json          # FULL monolith (unchanged contract) — source of truth
  cartridge-parts/
    core.json             # cartridge minus tier1.messages + minus tier1.search.sample texts…
                          #   plus: parts manifest
    messages-000.gcf … N  # byte-range chunks of the .gcf twin (aligned to idx anchors!)
```
`core.json.integrity` gains (all covered by content_manifest — computed over core+parts):
```json
"shards":[{"file":"messages-000.gcf","rows":[0,4095],"sha256":"...","bytes":123456}, ...]
```

### 6.2 Boot flow changes (`packages/shared/src/runtime-core.mjs` — L4 owns this file)

```js
export async function bootCartridge(fetchImpl){
  const core=await getJSON('/cartridge-parts/core.json');          // try sharded
  if(!core.integrity?.shards) return legacyMonolithBoot(fetchImpl); // existing path, unchanged
  // 1. verify core content_manifest over projection with shard table
  // 2. progressive message load: fetch shards via Range or whole-file (each ≤ ~8MB),
  //    decode with decodeCanonicalMessages (streaming row parse), verify per-shard sha256,
  //    GCF↔declared-rows cross-check per shard (same rule as today, chunked)
  // 3. runtime_manifest verified over the CONCATENATED projection (order = shard order)
  // 4. return cartridge-like object; UI boots after core+first shard; remaining shards
  //    stream in background (progress callback → HUD)
}
```
Hard rules: any shard hash mismatch → throw (fail closed, identical error surface); no partial unverified data ever handed to UI; `verifyCartridge` API unchanged.

### 6.3 `apps/room/src/main.ts` (L4-owned edits, boot path only)
- `loadCartridge()` uses new boot; adds progress state to HUD (`Verifying archive… 2/59 shards`).
- Nothing else in main.ts changes (canvas/panels untouched by L4).

### 6.4 Acceptance
- Unit (node): shard emit → boot via file-fetch shim → `verifyCartridge` PASS; corrupt 1 byte in shard 3 → boot throws with shard id in message.
- Browser (INT): real 242k archive — time-to-interactive improvement measured (target: HUD interactive < 30s vs current ~90-120s; full verify may continue in background but door stays locked until `integrityOK`).
- Monolith regression: fixture (no shards) boots unchanged (existing tests cover).

Effort: ~1.5 days. Rollback: sharding is additive; presence of `cartridge-parts` is what activates it — delete dir to fall back.

---

## 7. LANE L3b/L6 — truncation semantics (small, can ride with L3 agent)

- `compile.mjs` (INT applies; L3 prepares patch text): wrap raw-JSON parse in recover mode: on `JSON.parse` failure, scan for last complete top-level record boundary, set `cartridge.chat.truncated=true`, `cartridge.source.truncated_bytes=<recovered count>`; `--strict` CLI flag → hard fail instead. UI: HUD renders `⚠ truncated archive (N of M messages recovered)` when flag present. Tests: truncated fixture file (cut mid-record) → compile succeeds with flag; strict → exit≠0.
- Mirrors gcfc main.rs:319-347 semantics (salvage telegram-only, header-stamped).

---

## 8. INTEGRATION PHASE (orchestrator, serial, after L1b+L2+L4)

Checklist, exact order:
1. `compile.mjs`: import `episodes.mjs` (replace inline makeEpisodes), add truncation patch, add `--strict`; emit `cartridge-parts/` + `.idx.gcf`/`.map.gcf` via `gcf-sidecar.mjs` (producer per §4.3); bump `version:3→4`, keep `schema:'room-of-us/v2'` (additive fields only — verifyCartridge unchanged).
2. Add `'echo'` to: gauntlet allowed-types (tools/gauntlet-check.mjs:18), Mirror TRANSFER lens, Machine CONNECT filter, Books filter (exclude echo — it's pair-based), `QA_REPORT` addendum.
3. New gauntlet checks (+6 → 41): sidecar roundtrip on fixture; anchor-offset precision; echo present with valid meta on enriched fixture (`EMBED_MOCK=1`); shard boot + tamper detection; truncation salvage; strict-mode failure.
4. Real archive full run: `compile (timed) → embed (NIM, ECHO on) → verify:sidecar → verify:cartridge → build → browser smoke (sharded boot timing, echo panel visible, door unlockable)`.
5. Docs: README (echo enrichment, sharded boot, truncation), QA_REPORT addendum, this file marked EXECUTED with results table.
6. Recommit `dist` zip only on user request.

**Verification matrix (INT gate — all must pass):**
| Check | Command |
|---|---|
| Types | `npm run typecheck` |
| Units | `npm test` (expect 10 old + ~14 new) |
| Fixture chain | `npm run verify:fixture && npm run verify:runtime && npm run verify:paths` |
| Sidecars | `npm run verify:sidecar` (own + B's embed artifacts) |
| Real cartridge | `npm run verify:cartridge` |
| Build | `npm run build` |
| Browser | playwright smoke: sharded-boot timing, echo render, door, tamper error surface |

---

## 9. Risk register

| Risk | Mitigation |
|---|---|
| Stemmer bridge (Python↔node) drift | Single source of truth (`stem.mjs`); bridge is one batch call, cached; golden tests both sides |
| Anchor offsets desync (pre/post write capture) | Offset-capture rule documented in module + property test (§4.1); verify-sidecar CLI checks byte precision |
| Shard sha256 vs streaming fetch partial reads | Shards are whole-file fetches initially (Range optimization later); hash over full buffer |
| Echo semantic drift vs B | Constants table copied verbatim; acceptance test vectors derived by running B's discover.py on same synthetic corpus once during L2 |
| Memory: echo pairwise on 3.5k eps | `big` filter (n≥12) bounds it (B's own bound); numpy matmul as in B |
| Reseat/integrity regressions | Every lane leaves `npm run verify` green before handoff; INT re-runs full matrix |
| Real-archive recompile time | Unchanged (~5.5 min); sharding adds ~1 min IO |

## 10. Estimates & schedule

| Lane | Agent | Effort | Parallelizable in phase |
|---|---|---|---|
| L1a stem+background | @fixer 1 | 0.5d | 0 |
| L1b episodes | @fixer 2 | 0.5d | 0 |
| L3 sidecar+packroot | @fixer 3 | 1d | 0 |
| L6 truncation | rides with L3 | 0.25d | 0 |
| L2 echo | @fixer 4 | 1d | 1 (after L1a) |
| L4 sharded boot | @fixer 5 | 1.5d | 1 (after L3) |
| INT | orchestrator | 0.5d | 2 |
| **Total** | | **~5.25d serial, ~2.5d wall with parallelism** | |

## 11. Anti-goals (explicitly NOT doing)
- No numeric door gate, no unverified hashes, no `||`-escape tests, no per-class caps without diversity, no Phaser/dep injection, no remote calls at runtime, no demo fallback — A's invariants are immutable.
- M7 (Rust backend) deferred: current compile perf acceptable; revisit only if archives >1M messages.
