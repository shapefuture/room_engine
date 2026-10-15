# Room of Us — Blind QA Report

## Final status

**Core verification: PASS**

Executed from a repository path containing spaces.

- `npm run verify` — PASS
- `npm test` — **7/7 PASS**
- strict TypeScript (`tsc --noEmit`) — PASS
- fixture cartridge boot + integrity + GCF — PASS
- runtime smoke (shared boot path + local search + semantic door probe) — PASS
- Gauntlet — **35/35 behavioral checks PASS**
- deterministic fixture compilation — PASS
- space-containing input/output path — PASS
- 20k benchmark — PASS

## Benchmark

Synthetic 20,000-message corpus on the validation CPU:

- messages: 20,000
- episodes: 250
- compile time: ~1.11 s in the final path check
- throughput: ~17,963 messages/s
- cartridge: ~6.27 MB

## Defects closed in this loop

1. **Gemini enrichment boot break** — resealing now recomputes both `evidence_records` and `semantic_candidates` before generating the content manifest; simulated post-enrichment evidence changes pass `verifyCartridge`.
2. **Dead discovered Set** — removed; inventory is the only persisted progression collection.
3. **Duplicate `msgMap()` / `displayName()` helpers** — removed.
4. **Duplicate lint/typecheck script** — removed.
5. **AI enrichment metadata** — model, rationale, and counterevidence requirement are rendered in discovery views.
6. **Rich span payload** — offsets, span kinds, and hrefs are rendered in evidence.
7. **Link type** — rendered alongside host.
8. **Episode status/participants** — exposed when drilling into Atlas/Telescope episodes.
9. **Source digest / embedding model** — visible in Archive statistics.
10. **Unified semantic utilities** — tokenizer and GCF parser live in shared modules; runtime, compiler, and verification reuse them.
11. **Runtime smoke theater** — replaced by a shared boot-contract test that actually fetches JSON/GCF, decodes GCF, validates manifests, searches, and exercises the semantic-door condition.
12. **Gauntlet source-grep theater** — replaced by behavioral compilation, negative-emergence, enrichment/reseal, tamper, boot, and artifact tests.
13. **Icon placeholder** — 512px icon now has an actual 512×512 viewBox/artwork rather than a copied 192px asset.
14. **Generic Mirror roles** — role is supplied in the canonical participant model (`--role=...=HER/HIM`); runtime no longer hardcodes Viktor.
15. **Demo shipping footgun** — compiled fixture is no longer written into `public/`; production `npm run compile` is a real parameterized CLI.
16. **Search/sample behavior** — fixture verification ensures a populated archive has a non-empty notable-evidence sample.
17. **HUD escaping** — `textContent` receives raw text; HTML escaping is used only for HTML interpolation.
18. **Service-worker freshness** — dynamic cartridge/GCF resources use network-first behavior with `cache:'no-store'`.
19. **Duplicate/stale artifacts** — no compiled demo cartridge, legacy index, enrichment sidecar, embeddings sidecar, or duplicate CPU preview is shipped.
20. **Integrity** — content-addressed manifest covers the complete cartridge payload; verification checks structure and manifest values rather than equal-length self-reference.
21. **Repository history** — initialized git history with a first closure commit so audit changes are reviewable.
22. **Demo compiler footgun** — removed the obsolete standalone `compile-demo.mjs`; fixture generation is now isolated under `verify:fixture` and never touches `public/`.

## Verification boundary

A real Vite production bundle is the only unresolved environment boundary. The sandbox has no installed Vite dependency and registry installation timed out. `tsc --noEmit`, compiler tests, cartridge verification, runtime boot/search/door tests, behavioral Gauntlet, and space-path execution all pass. The repository deliberately does **not** claim `npm run build` passed when it was not executable in this environment.

## Addendum — independent audit fixes

An external line-level audit found defects the suite above could not see (its corpora never exceeded the discovery cap, and no browser ever executed `main.ts`). All are fixed and covered by new regression tests:

1. **Critical (compiler):** `integrity.evidence_records` was counted over the full deduped candidate list while `tier0.discoveries` stores only the top 36 — any archive yielding >36 candidates produced a cartridge that failed its own `verifyCartridge` at boot. Counts are now taken from the stored discoveries; regression test compiles a 600-message corpus past the cap and verifies.
2. **Critical (runtime):** `drawRoom()` ran synchronously before cartridge boot completed and dereferenced the unloaded cartridge via the door's semantic check — an uncaught TypeError on every page load. `doorUnlocked()` now guards on a booted cartridge.
3. **third_mind consistency:** emergence candidates were selected from the untruncated candidate list and could reference discoveries absent from `tier0.discoveries`; now derived from the stored slice.
4. **Span offsets:** rich-span `[start:end]` offsets were measured on pre-normalization text while stored text is normalized; spans are now measured on the exact stored text, and plain-text URLs additionally produce link metadata.
5. Minor: dead re-export shim removed, internal-only helpers un-exported, Gemini default model pinned to a stable ID (`gemini-2.5-flash`), CPU-embed reseal path made CWD-independent, service-worker CORE list cleaned, search rows use participant names, canvas background matches theme color, vestigial "seen" ternary replaced by explicit per-object dim flags, CI workflow added.
6. **Embedding backend replaced**: `tools/embed_cpu.py` no longer requires sentence-transformers/torch. It now uses `tools/free_embeddings.py` — free remote providers (SiliconFlow bge-m3 → NVIDIA NIM → Gemini text-embedding-004) with rotation and a local CPU fallback (fastembed/Ollama). All items in a run embed through one provider to keep the vector space homogeneous; `EMBED_MOCK=1` exercises the pipeline offline; batch embedding added (`embed_batch_once`) because the single-text path silently dropped all but the first vector of a batch. Verified offline via mock and via real fastembed (multilingual MiniLM), both resealing to cartridges that pass `verifyCartridge`.

Still open by environment: an executed `npm run build` plus one headless-browser smoke against the built bundle remain the only uncovered surfaces.

## Addendum 2 — merge round (best-of-both with the embed/ implementation)

Executed the full MERGE_PLAN (all lanes; nothing deferred). Verification: 48/48 unit tests (18 new), Gauntlet extended 35→41 behavioral checks, typecheck strict, fixture/runtime smoke, and a full real-archive rerun (241,965 messages).

1. **Echo discoveries (M1/L2)** — port of B's pairwise episode-similarity engine into the enrichment stage: distant episodes (≥5 days) with cosine ≥0.55 but lexical Jaccard ≤0.22 — "same meaning, different words". Mock backends refuse to fabricate echoes (theater guard, gauntlet check 40).
2. **Snowball-RU stemmer + Gries background model (M2/L1a)** — differentially verified against B's Python (62/62 stems, 2,920/2,920 background property checks).
3. **TextTiling episodes (M3/L1b)** — two-pass segmentation (gap+continuity, cohesion valleys); the real archive now yields 5,532 episodes (was 3,535 by gap+count).
4. **Sidecars + pack-root (M4/M5/L3)** — gcfc-wire-compatible `.idx.gcf`/`.map.gcf` with byte-exact anchor offsets and `gcf-pack-root-v1` hashing; cross-verified against gcfc's own real artifacts (319 anchors / 20,400 rows parse + `verify-sidecar` PASS) and on our 242k archive (3,781 anchors / 241,965 rows).
5. **Sharded boot (L4)** — `cartridge-parts/` (60 shards) with per-shard SHA-256, contiguity and manifest verification over the reassembled payload; monolith fallback preserved. Tamper/missing/reorder/rehash attacks all fail closed (7 unit tests + gauntlet 36-37).
6. **Truncation recovery (M6)** — source-scan salvage of complete records with `chat.truncated=true` provenance; `--strict` refuses (gauntlet 38-39).
7. **Parallel compile (M7)** — worker-threads path (threshold 50k msgs, env-overridable): the 242k archive compiles in **50s vs 395s** (~8×), byte-identical manifests proven by gauntlet check 41.
8. Not adopted: Phaser UI (violates zero-dep; rejected, not deferred); B's numeric door gate, unverified hashes, escape-hatch tests remain anti-goals.
