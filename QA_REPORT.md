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

## Verification boundary

A real Vite production bundle is the only unresolved environment boundary. The sandbox has no installed Vite dependency and registry installation timed out. `tsc --noEmit`, compiler tests, cartridge verification, runtime boot/search/door tests, behavioral Gauntlet, and space-path execution all pass. The repository deliberately does **not** claim `npm run build` passed when it was not executable in this environment.
