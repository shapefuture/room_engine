#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FREE EMBEDDING API TESTER — top 3 providers + rotation + self-test
================================================================
Providers (in priority order = your "top 3"):
  1. SiliconFlow      -> BAAI/bge-m3            (near-unlimited, 100+ langs incl. Russian)
  2. NVIDIA NIM       -> nvidia/nv-embedqa-e5-v5 (near-unlimited @ ~40 RPM, big catalog)
  3. Google Gemini    -> text-embedding-004     (~1,500 req/day, free, no card)

Optional extras (comments at the bottom of PROVIDERS): Hugging Face multilingual-e5
(strong Russian), Mistral, Voyage, Jina, Cohere, ModelScope, Zhipu, OpenRouter.

FEATURES
  * Multi-provider fallback + rotation (jumps to next on error / HTTP 429 / timeout).
  * Matryoshka / configurable output dimensions where supported.
  * --test mode: embeds an English + a Russian sample through each provider that
    has a key, prints dims, latency and a self-similarity sanity check.
  * --mock mode: runs the FULL pipeline with NO API keys by spinning up a tiny local
    OpenAI-compatible mock server. Use it to verify the code/plumbing works offline.

KEYS via environment variables (preferred, not committed):
  SILICONFLOW_KEY, NVIDIA_NIM_KEY, GEMINI_KEY
  (also HF_KEY, MISTRAL_KEY, VOYAGE_KEY, JINA_KEY, COHERE_KEY, MODELSCOPE_KEY,
   ZHIPU_KEY, OPENROUTER_KEY)

Examples
  python3 free_embeddings.py --mock                      # offline self-test, no keys
  python3 free_embeddings.py                              # use real keys from env
  python3 free_embeddings.py --embed "Текст на русском"
  python3 free_embeddings.py --test --dims 512

LOCAL FALLBACK (no GPU, offline) — installed & verified on this machine:
  export LOCAL_ENGINE=fastembed          # fastembed (default) | ollama | '' to disable
  export LOCAL_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
  python3 free_embeddings.py --local-list              # show engines/models
  python3 free_embeddings.py --embed "Текст"            # remote first, local last
  python3 free_embeddings.py --local only --embed "... " # local ONLY (offline)
  python3 free_embeddings.py --local first --embed "... " # local first, then remote
  LOCAL_MODE=only / LOCAL_ONLY=1  # force offline-only via env
"""

# REQUIREMENTS
#   pip install fastembed onnxruntime     (CPU-only local fallback; no GPU)
#   (optional) install Ollama -> https://ollama.com for LOCAL_ENGINE=ollama

import argparse
import os
import sys
import time
import threading
import hashlib
import http.server
import json
import shutil
import subprocess

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None
    import urllib.request
    import urllib.error


# --------------------------------------------------------------------------- #
# Provider registry. Order == rotation priority. Add more by appending a dict.
# --------------------------------------------------------------------------- #
PROVIDERS = [
    {
        "name": "siliconflow",
        "key_env": "SILICONFLOW_KEY",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "BAAI/bge-m3",
        "dims": 1024,
        "supports_dims": False,     # bge-m3 is fixed 1024
        "embed_path": "/embeddings",
        "header_key": "input",      # API key goes in "input"
    },
    {
        "name": "nvidia_nim",
        "key_env": "NVIDIA_NIM_KEY",
        "base_url": "https://integrate.api.nvidia.com/v1",
        # nv-embedqa-e5-v5 reached end of life on 2026-08-25; nemotron-3 is the
        # current multilingual retrieval model on the NIM catalog (2048 dims,
        # no Matryoshka `dimensions` support).
        "model": "nvidia/nemotron-3-embed-1b",
        "dims": 2048,
        "supports_dims": False,
        "embed_path": "/embeddings",
        "header_key": "input",
    },
    {
        "name": "gemini",
        "key_env": "GEMINI_KEY",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "model": "text-embedding-004",   # gemini-embedding-001 also works
        "dims": 768,                     # 768 or 3072
        "supports_dims": True,
        # Gemini uses a different (":embedContent") shape; handled below.
        "gemini_style": True,
        "embed_path": "/:embedContent",
        "header_key": "query",
    },
    # --- optional extras (uncomment / add keys to enable) ------------------
    # {
    #     "name": "huggingface",       # multilingual-e5-large-instruct: STRONG Russian
    #     "key_env": "HF_KEY",
    #     "base_url": "https://router.huggingface.co/v1",
    #     "model": "intfloat/multilingual-e5-large-instruct",
    #     "dims": 1024,
    #     "supports_dims": False,
    #     "embed_path": "/embeddings",
    #     "header_key": "input",
    # },
    # {
    #     "name": "mistral",
    #     "key_env": "MISTRAL_KEY",
    #     "base_url": "https://api.mistral.ai/v1",
    #     "model": "mistral-embed",
    #     "dims": 1024,
    #     "supports_dims": False,
    #     "embed_path": "/embeddings",
    #     "header_key": "input",
    # },
    # {
    #     "name": "jina",
    #     "key_env": "JINA_KEY",
    #     "base_url": "https://api.jina.ai/v1",
    #     "model": "jina-embeddings-v4",
    #     "dims": 2048,
    #     "supports_dims": True,
    #     "embed_path": "/embeddings",
    #     "header_key": "input",
    # },
]


# --------------------------------------------------------------------------- #
# LOCAL MODEL FALLBACK  (no GPU, no API key, runs offline on CPU)
# --------------------------------------------------------------------------- #
# Two engines, tried in order, then any still-configured remote provider:
#   1. Ollama            -> small embedding models via `ollama run` (fast, any model)
#   2. fastembed (ONNX)  -> lightweight, CPU-only, no GPU/library hassle (default)
# Configure with:
#   LOCAL_ENGINE   = "fastembed" | "ollama" | "" (disable)      [default: fastembed]
#   LOCAL_MODEL    = fastembed model name / Ollama tag          [see below]
#   LOCAL_ONLY     = "1" -> skip ALL remote providers (offline-only)
#
# The default fastembed model is MULTILINGUAL (handles Russian/Cyrillic), small
# and CPU-fast. It downloads ~90 MB on first use into LOCAL_CACHE_DIR.

DEFAULT_LOCAL_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
# ^ multilingual incl. Russian, 384 dims, ~90 MB, ~90 ms/embed on CPU.
# Alternatives (supported by fastembed):
#   intfloat/multilingual-e5-large     (1024 dims, best quality, ~2.2 GB download)
#   BAAI/bge-small-en-v1.5             (384 dims, EN-focused, ~40 MB)
#   nomic-ai/nomic-embed-text-v1.5     (768 dims, EN, ~90 MB)
# Ollama models (install `ollama`): bge-m3, nomic-embed-text, mxbai-embed-large

_LOCAL_ENGINE = os.environ.get("LOCAL_ENGINE", "fastembed").strip().lower()
_LOCAL_MODEL = os.environ.get("LOCAL_MODEL", DEFAULT_LOCAL_MODEL)
_LOCAL_CACHE = os.environ.get("LOCAL_CACHE_DIR", os.path.expanduser("~/.embedcache"))


def _local_available():
    """Return True if any local engine we can use is present."""
    if _LOCAL_ENGINE == "ollama":
        return shutil.which("ollama") is not None
    if _LOCAL_ENGINE == "fastembed":
        try:
            import fastembed  # noqa: F401
            return True
        except Exception:
            return False
    return False


class _LocalEmbedder:
    """Lazy-loads a local model and embeds on CPU. Cheap caching via dict."""

    def __init__(self, model=None, engine=None):
        self.model = model or _LOCAL_MODEL
        self.engine = (engine or _LOCAL_ENGINE).lower()
        self._backend = None
        self._cache = {}

    def _init_backend(self):
        if self.engine == "ollama":
            if shutil.which("ollama") is None:
                raise RuntimeError("ollama not found. Install it: https://ollama.com")
            self._backend = "ollama"
            return
        # fastembed
        from fastembed import TextEmbedding
        self._backend = TextEmbedding(
            model_name=self.model, cache_dir=_LOCAL_CACHE)
        self._label = "fastembed"

    def embed(self, texts):
        if self._backend is None:
            self._init_backend()
        out = []
        for t in (texts if isinstance(texts, list) else [texts]):
            if t in self._cache:
                out.append(self._cache[t])
                continue
            if self.engine == "ollama":
                # `ollama run <model>` returns JSON-ish; use /api/embed endpoint instead
                import urllib.request
                body = json.dumps({"model": self.model, "input": t}).encode()
                req = urllib.request.Request(
                    "http://localhost:11434/api/embed", data=body,
                    headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(req, timeout=60) as resp:
                    vec = json.loads(resp.read().decode())["embeddings"][0]
                del resp
            else:
                vec = [float(x) for x in next(iter(self._backend.embed([t])))]
            self._cache[t] = vec
            out.append(vec)
        return out if isinstance(texts, list) else out[0]


_LOCAL = _LocalEmbedder()


def embed_local(text):
    """Force a local CPU embedding (no network). Returns (vector, "local:engine")."""
    vec = _LOCAL.embed(text)
    engine = _LOCAL.engine if _LOCAL.engine == "ollama" else (
        "fastembed" if _LOCAL.engine == "fastembed" else "local")
    return vec, f"local:{engine}"


def add_local_fallback(providers):
    """Prepend a local provider to the rotation chain so it's tried FIRST
    when LOCAL_ONLY=1, or append it as the LAST fallback otherwise."""
    local_prov = {
        "name": f"local({_LOCAL.engine})",
        "key_env": "__local__",
        "base_url": "", "model": _LOCAL_MODEL,
        "dims": None, "supports_dims": False,
        "embed_path": "", "header_key": "input",
        "_local": True,
    }
    if os.environ.get("LOCAL_ONLY") == "1":
        return [local_prov] + [p for p in providers if not p.get("_local")]
    # default: local is the LAST fallback after all remote providers
    return providers + [local_prov]


# --------------------------------------------------------------------------- #
# Low-level HTTP (requests preferred, urllib fallback)
# --------------------------------------------------------------------------- #
def _post(url, headers, data, timeout=30):
    if requests is not None:
        r = requests.post(url, headers=headers, json=data, timeout=timeout)
        return r.status_code, r.text
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# --------------------------------------------------------------------------- #
# Build the request for a provider (handles Gemini's different shape).
# --------------------------------------------------------------------------- #
def _payload_for(provider, texts, dims):
    if provider.get("gemini_style"):
        # Gemini :embedContent takes ONE content at a time
        body = {"content": {"parts": [{"text": texts[0]}]}}
        if dims and provider["supports_dims"]:
            body["outputDimensionality"] = dims
        return body
    payload = {"model": provider["model"], "input": texts}
    if dims and provider["supports_dims"]:
        payload["dimensions"] = dims
    return payload


def _extract_vector(provider, data):
    """Return a list[float] vector from a provider JSON response."""
    if provider.get("gemini_style"):
        return data["embedding"]["values"] if "embedding" in data else data["values"]
    # OpenAI-compatible response: {"data":[{"embedding":[...]}], ...}
    return data["data"][0]["embedding"]


# --------------------------------------------------------------------------- #
# Single embedding call with per-provider errors surfaced for fallback.
# --------------------------------------------------------------------------- #
def embed_once(provider, texts, dims=None):
    key = os.environ.get(provider["key_env"])
    if not key:
        return None, "no-key"
    path = provider["embed_path"]
    if provider.get("gemini_style"):
        # Gemini wants the model id inline in the path, e.g. .../text-embedding-004:embedContent
        url = f"{provider['base_url']}/{provider['model']}{path}?key={key}"
        headers = {"Content-Type": "application/json"}
    else:
        url = provider["base_url"] + path
        headers = {"Authorization": f"Bearer {key}",
                   "Content-Type": "application/json"}
    body = _payload_for(provider, texts, dims)
    status, text = _post(url, headers, body, timeout=30)
    if status != 200:
        return None, f"http-{status}:{text[:160]}"
    try:
        data = json.loads(text)
    except Exception as e:
        return None, f"json-error:{e}"
    try:
        vec = _extract_vector(provider, data)
        return [float(x) for x in vec], "ok"
    except Exception as e:
        return None, f"parse-error:{e}"


# --------------------------------------------------------------------------- #
# Batch embedding: returns ONE vector PER input text (embed_once above only
# surfaces data[0]). OpenAI-compatible providers take the whole batch in one
# request; Gemini-style providers are expanded to per-item calls.
# --------------------------------------------------------------------------- #
def embed_batch_once(provider, texts, dims=None):
    if provider.get("gemini_style"):
        vecs = []
        for t in texts:
            v, st = embed_once(provider, [t], dims)
            if st != "ok":
                raise RuntimeError(f"{provider['name']}: {st}")
            vecs.append(v)
        return vecs
    key = os.environ.get(provider["key_env"])
    if not key:
        raise RuntimeError(f"{provider['name']}: no-key")
    url = provider["base_url"] + provider["embed_path"]
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = _payload_for(provider, texts, dims)
    status, text = _post(url, headers, body, timeout=30)
    if status != 200:
        raise RuntimeError(f"{provider['name']}: http-{status}:{text[:160]}")
    try:
        data = json.loads(text)
        rows = [row["embedding"] for row in data["data"]]
        if len(rows) != len(texts):
            raise RuntimeError(f"batch width mismatch: sent {len(texts)}, got {len(rows)}")
        return [[float(x) for x in row] for row in rows]
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"{provider['name']}: parse-error:{e}")


# --------------------------------------------------------------------------- #
# Rotating/fallback embed: try providers in order, return first success.
# --------------------------------------------------------------------------- #
def embed(text, dims=None, providers=None, verbose=True, use_local="auto"):
    """Embed `text` trying remote providers in order, then the LOCAL model
    as a final fallback (unless use_local=False).

    use_local: "auto" -> try remote first, local last
               "first" -> local first
               "only"  -> local only (no network)
               False   -> never use local
    """
    providers = providers or PROVIDERS
    texts = [text] if isinstance(text, str) else text
    last_error = None
    # "only" -> try local exclusively (offline, no network)
    if use_local == "only":
        try:
            vec = _LOCAL.embed(texts)
            return (vec[0] if isinstance(text, str) else vec), f"local:{_LOCAL.engine}"
        except Exception as e:
            raise RuntimeError(f"Local embedding failed: {e}")

    # Build the ordered chain (remote providers + optional local position)
    remote = [p for p in providers if not p.get("_local")]
    local_prov = add_local_fallback([])[:1]
    if use_local == "first":
        chain = local_prov + remote
    elif use_local is False:
        chain = remote
    else:  # "auto" -> remote first, local last
        chain = remote + local_prov

    for provider in chain:
        if provider.get("_local"):
            try:
                vec = _LOCAL.embed(texts)
                vec_out = vec[0] if isinstance(text, str) else vec
                if verbose:
                    print(f"  [ok] {provider['name']:<12} dims={len(vec_out)} "
                          f"via local model {provider['model']}")
                return vec_out, provider["name"]
            except Exception as e:
                last_error = f"local:{e}"
                if verbose:
                    print(f"  [skip] local: {e}")
                continue
        vec, status = embed_once(provider, texts, dims)
        if status == "ok":
            if verbose:
                print(f"  [ok] {provider['name']:<12} dims={len(vec)} via {provider['model']}")
            return vec, provider["name"]
        err = f"{provider['name']}: {status}"
        if verbose:
            print(f"  [skip] {err}")
        last_error = err

    raise RuntimeError(f"All providers failed: {last_error}")


# --------------------------------------------------------------------------- #
# Euclidean-free sanity helpers (no numpy assumed; small vectors OK).
# --------------------------------------------------------------------------- #
def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5 or 1
    nb = sum(x * x for x in b) ** 0.5 or 1
    return dot / (na * nb)


# --------------------------------------------------------------------------- #
# --mock : a tiny OpenAI-compatible local server so the test works w/ no keys.
# Returns deterministic pseudo-vectors: similar text -> similar cosine.
# --------------------------------------------------------------------------- #
class _MockHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence
        pass

    def _vec(self, text):
        h = hashlib.sha256(text.encode("utf-8", "ignore")).digest()
        base = [b / 255.0 for b in h[:max(8, min(16, len(h)))]]
        # add a length component so very different-length texts separate a bit
        base = base * 6
        return base

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        inp = body.get("input", ["test"])
        if isinstance(inp, str):
            inp = [inp]
        data = [{"object": "embedding", "index": i, "embedding": self._vec(t)}
                for i, t in enumerate(inp)]
        resp = {"data": data, "model": body.get("model", "mock"),
                "usage": {"prompt_tokens": 1, "total_tokens": 1}}
        out = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def run_mock_server(port=18080):
    srv = http.server.HTTPServer(("127.0.0.1", port), _MockHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, port


def make_mock_provider(port):
    return {
        "name": "mock_local", "key_env": "MOCK_KEY",
        "base_url": f"http://127.0.0.1:{port}/v1",
        "model": "mock/bge-m3", "dims": 48, "supports_dims": False,
        "embed_path": "/embeddings", "header_key": "input",
    }


# --------------------------------------------------------------------------- #
# --test : exercise each configured provider that has a key; report results.
# --------------------------------------------------------------------------- #
def run_test(dims=None, providers=None):
    samples = [
        ("en", "The quick brown fox jumps over the lazy dog."),
        ("ru", "Быстрая коричневая лиса перепрыгивает через ленивую собаку."),
    ]
    print("=" * 74)
    print("FREE EMBEDDING API TEST — top-3 providers (+ any extras with a key)")
    print("=" * 74)
    okay = 0
    # Always include a local engine self-test (no key needed) if available.
    if _local_available():
        print(f"\n[local:{_LOCAL.engine}]  model={_LOCAL_MODEL}  (CPU, no key)")
        lv = []
        for lang, txt in samples:
            t0 = time.time()
            vec = _LOCAL.embed(txt)
            lv.append((lang, vec, (time.time() - t0) * 1000))
        for lang, vec, ms in lv:
            print(f"    {lang:<3} dims={len(vec):<5} latency={ms:6.1f}ms")
        self_sim = cosine(lv[0][1], lv[0][1])
        cross = cosine(lv[0][1], lv[1][1])
        print(f"    self-sim(identical)={self_sim:.3f}  en~ru sim={cross:.3f}  -> local OK")
        okay += 1
    for provider in providers:
        name = provider["name"]
        if not os.environ.get(provider["key_env"]):
            print(f"\n[{name}]           <-- no key in env; skipping  (set {provider['key_env']})")
            continue
        print(f"\n[{name}]  model={provider['model']}  dims={provider['dims']}"
              f"{' (Matryoshka)' if provider['supports_dims'] else ''}")
        vecs = {}
        for lang, txt in samples:
            t0 = time.time()
            vec, status = embed_once(provider, [txt], dims)
            ms = (time.time() - t0) * 1000
            if status != "ok":
                print(f"    FAIL {lang}: {status}")
                break
            vecs[lang] = vec
            print(f"    {lang:<3} dims={len(vec):<5} latency={ms:6.1f}ms")
        else:
            # Sanity: self-similarity of identical text should be ~1.0,
            # and the RU one shouldn't be degenerate (all zeros / NaN).
            self_sim = cosine(vecs["en"], vecs["en"])
            cross = cosine(vecs["en"], vecs["ru"])
            print(f"    self-sim(identical)={self_sim:.3f}  en~ru sim={cross:.3f}  -> OK")
            okay += 1
    print("\n" + "=" * 74)
    print(f"Providers successfully tested: {okay}  (add keys with export ... )")
    print("=" * 74)
    return okay


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main():
    p = argparse.ArgumentParser(description="Test free embedding providers / rotate keys + local fallback.")
    p.add_argument("--test", action="store_true", help="run the multi-provider test suite")
    p.add_argument("--mock", action="store_true", help="run against a local mock (no keys needed)")
    p.add_argument("--embed", metavar="TEXT", help="embed a single text, print vector + provider")
    p.add_argument("--dims", type=int, default=None, help="requested output dimensionality")
    p.add_argument("--list", action="store_true", help="list configured providers")
    p.add_argument("--local", choices=["auto", "only", "first", "off"], default=os.environ.get("LOCAL_MODE", "auto"),
                   help="how to use the local CPU model fallback")
    p.add_argument("--local-list", action="store_true", help="list available/usable local engines + models")
    args = p.parse_args()

    # local mode resolution
    use_local = {"auto": "auto", "only": "only", "first": "first", "off": False}[args.local]
    if os.environ.get("LOCAL_ONLY") == "1":
        use_local = "only"

    # --mock documents itself as an offline self-test; imply --test when no
    # other action flag was given.
    if args.mock and not (args.test or args.embed or args.list or args.local_list):
        args.test = True

    if args.local_list:
        print(f"LOCAL_ENGINE    = {_LOCAL_ENGINE}")
        print(f"LOCAL_MODEL     = {_LOCAL_MODEL}")
        print(f"cache dir       = {_LOCAL_CACHE}")
        print(f"engine available? fastembed: {_local_available()}")
        print(f"ollama present? {shutil.which('ollama') is not None}")
        print("Supported via env LOCAL_ENGINE/LOCAL_MODEL.")
        return

    providers = PROVIDERS
    if args.mock:
        # Auto-enable a mock provider that the mock server "serves".
        os.environ["MOCK_KEY"] = "mock"
        srv, port = run_mock_server()
        providers = [make_mock_provider(port)]
        print(f"[mock] local server on 127.0.0.1:{port} — no API keys needed.\n")

    if args.list:
        for pr in providers:
            print(f"  {pr['name']:<12} model={pr['model']:<24} dims={pr['dims']}"
                  f"  key_env={pr['key_env']}")
        print(f"  local:{_LOCAL.engine:<9} model={_LOCAL_MODEL}   (no key)")
        return

    if args.test:
        run_test(args.dims, providers)
        return

    if args.embed:
        vec, used = embed(args.embed, args.dims, providers, use_local=use_local)
        print(f"provider={used}  dims={len(vec)}  head={vec[:5]}  tail={vec[-3:]}")
        return

    print("Nothing to do. Use one of: --test  --mock  --embed TEXT  --list  --local-list")
    print("  --test       : needs real keys (exports) to hit real APIs; also tests local")
    print("  --mock       : full pipeline, no keys, offline")
    print("  --local only : embed purely on CPU, no network (offline fallback)")


if __name__ == "__main__":
    main()
