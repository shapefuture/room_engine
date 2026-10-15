# The Room of Us

A CPU-only, offline friendship archive rendered as one interactive 2D room.

## Architecture

1. **Compiler** — Telegram JSON → canonical message model → episodes → evidence-backed deterministic candidates → local search/semantic indexes → cartridge. Worker-parallel on large archives (242k messages compile in ~50s), with two-pass TextTiling episode segmentation, gcfc-compatible `.idx.gcf`/`.map.gcf` sidecars (byte-range provenance + `gcf-pack-root-v1`), sharded `cartridge-parts/` output for chunked boot, and truncation recovery (`--strict` to refuse salvaged input).
2. **GCF transport** — canonical messages are emitted as compact GCF and hard-verified against the cartridge at runtime. The sharded boot path verifies per-shard SHA-256 plus the same three manifests over the reassembled payload; the monolith path additionally cross-checks GCF↔JSON.
3. **Room** — browser-native Canvas scene. No graph database, runtime backend, or runtime LLM is required.
4. **Optional enrichment** — free-tier embeddings (SiliconFlow bge-m3 / NVIDIA NIM / Gemini `text-embedding-004` with rotation, or a local CPU fastembed/Ollama model — no torch required) merge into the cartridge and reseal its content manifest, and additionally produce **echo** discoveries (distant episodes that recur in meaning but not in words: cosine ≥ 0.55 ∧ Jaccard ≤ 0.22) plus Snowball-RU stemming and the Gries background-word model. See `tools/free_embeddings.py` (`npm run embed:mock` for an offline plumbing self-test, `npm run embed:test` to probe configured providers).

## Real archive usage

Compile an actual Telegram Desktop JSON export with:

```bash
node packages/compiler/src/compile.mjs /path/to/result.json public/cartridge.json --role="Viktor=HIM" --role="Kristina=HER"
```

Then run the normal frontend build/dev commands.

The checked-in `data/demo/telegram.json` is a **fixture only**. `npm run compile` never overwrites the production cartridge; use an explicit input/output path for a real archive. The runtime has no fallback to fixture data and fails closed when its cartridge is missing or invalid.

## Verification

```bash
npm install
npm run verify:build-preflight
npm run typecheck
npm test
npm run verify:fixture
npm run verify:runtime
npm run verify:paths
```

The cartridge is content-addressed: modifying its payload without resealing changes the manifest and the room refuses to boot. The runtime also hard-fails on canonical GCF mismatch.

## Production build

`apps/room/vite.config.ts` resolves its root with `fileURLToPath(import.meta.url)`, so repository paths containing spaces are supported. The included build-preflight verifies the real Vite entry/config; the actual `npm run build` requires the pinned Vite dependency to be installed in `node_modules`.
