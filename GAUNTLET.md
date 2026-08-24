# Room of Us — Gauntlet Loop

## Goal

Build a CPU-only, offline, evidence-backed 2D friendship world from Telegram JSON. It must be a real interactive artifact, not a demo masquerading as a finished system: no fabricated fallback content, no dead semantic controls, no tautological integrity claims, no orphan enrichment data, and no runtime dependency on AI, graph databases, or GPU compute.

## Hard bar

The implementation must survive a blind audit that checks behavior rather than source claims. The current bar is the executed 35-check behavioral suite in `tools/gauntlet-check.mjs`, plus compiler unit tests, cartridge verification, runtime smoke tests, strict TypeScript validation, deterministic recompilation, and a 20k-message benchmark.

## Non-negotiable properties

- Every discovery has source evidence.
- Third Mind emergence requires cross-voice semantic evidence; episode length alone can never create it.
- Cartridge payload is content-addressed and tamper-sensitive.
- Canonical GCF must exactly match the runtime message projection or boot fails closed.
- Inventory and progression persist locally.
- Dynamic cartridge artifacts use network-first service-worker behavior; stale payloads must not silently win.
- No demo fallback is loaded when a production cartridge is unavailable.
- Telegram-specific metadata is normalized and rich evidence remains inspectable without polluting the model-facing hot path.
- The compiler and checks work from repository paths containing spaces.
- Optional Gemini/CPU semantic stages merge into and reseal the cartridge; they never create orphan sidecars.
- The fixture corpus is explicitly a test fixture, not a substitute for the user's real archive.

## Verification command

```bash
npm install
npm run verify
npm run benchmark
```

## Blind negative tests

The Gauntlet includes a corpus with two participants but no cross-voice semantic overlap; it must produce zero emergence candidates. It also mutates the cartridge payload after compilation and verifies the content manifest changes.

## Build caveat

`npm run build` is the final frontend packaging step. The checked environment in which this repository was validated could not install the pinned Vite dependency because the npm registry request timed out. `tools/build-preflight.mjs` therefore distinguishes source/config correctness from an actually executed production bundle rather than claiming the latter.
