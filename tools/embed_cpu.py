#!/usr/bin/env python3
"""Optional semantic enrichment. Embeds episodes + discoveries into nearest-neighbour
links, runs the ECHO discovery stage over episode vectors, merges them into the
cartridge, then reseals its content manifest.

Backend: tools/free_embeddings.py — free remote providers (SiliconFlow bge-m3,
NVIDIA NIM, Gemini text-embedding-004) with rotation, falling back to a local CPU
model (fastembed by default; LOCAL_ENGINE=ollama supported). No torch required.

Environment:
  SILICONFLOW_KEY / NVIDIA_NIM_KEY / GEMINI_KEY   remote providers (first with a key wins)
  LOCAL_ONLY=1                                    skip all remote providers (offline)
  EMBED_MOCK=1                                    offline plumbing test via the built-in mock server
  LOCAL_ENGINE / LOCAL_MODEL / LOCAL_CACHE_DIR    local engine configuration (see free_embeddings.py)
  ECHO_VEC_FILE=path.json                         override episode vectors for the echo stage

ECHO stage (port of B's discover.py:842-993): after episode vectors are computed,
episodes that are weeks apart yet semantically near-identical (cosine >= 0.55) while
sharing almost no vocabulary (stemmed Jaccard <= 0.22) become `type: "echo"`
discoveries. Three things are needed for it to fire:
  * a backend that carries real semantics — the EMBED_MOCK hash backend has none, so
    the stage prints one skip line and returns unless ECHO_VEC_FILE is set;
  * the stem/background model — we never re-implement it in Python; a single node
    subprocess imports packages/compiler/src/stem.mjs + background.mjs and batch-stems
    all episode words (single source of truth);
  * episode vectors — reused from the ones already embedded for episode_embedding_links.

ECHO_VEC_FILE is the override hook (testing / precomputed-batch): a JSON object mapping
`"episode:<id>"` -> [floats]. Vectors present in the file replace the embedded ones for
those episodes; the file must cover every episode (or the embedded vectors must share
the same dimensionality). It also re-enables the echo stage on the mock backend.

All items in one run are embedded through ONE provider so the vector space stays homogeneous;
if a provider fails mid-corpus the whole run moves to the next one.
"""
import json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import free_embeddings as fe

try:
    import numpy as np
except ImportError:  # pure-Python fallback below still works, just slower
    np = None


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b)); na = sum(x * x for x in a) ** 0.5; nb = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def _embed_chunk(provider, batch):
    for attempt in (0, 1):
        try:
            return fe.embed_batch_once(provider, batch)
        except RuntimeError as exc:
            if attempt == 0 and '429' in str(exc):
                time.sleep(6)  # rate-limited: back off once, then retry the chunk
                continue
            raise


def _embed_corpus(provider, texts):
    """Embed every text through one provider. Returns list of vectors or raises."""
    if provider.get('_local'):
        return [list(map(float, v)) for v in fe._LOCAL.embed(texts)]
    vectors = []
    chunk = 32
    total = (len(texts) + chunk - 1) // chunk
    for i in range(0, len(texts), chunk):
        vectors.extend(_embed_chunk(provider, texts[i:i + chunk]))
        print(f'  embedded {min(i + chunk, len(texts))}/{len(texts)} ({(i // chunk) + 1}/{total} batches)', flush=True)
    return vectors


def _nearest_links(vectors, keys, top=5):
    """Top-k cosine neighbours per item. Vectorised when numpy is present —
    a real archive has thousands of episodes and the pure-Python loop would
    take hours."""
    links = []
    if np is not None:
        mat = np.asarray(vectors, dtype=np.float32)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        unit = mat / norms
        sim = unit @ unit.T
        np.fill_diagonal(sim, -2.0)
        order = np.argsort(-sim, axis=1)[:, :top]
        for i, key in enumerate(keys):
            links.append({'id': key, 'nearest': [{'id': keys[j], 'score': round(float(sim[i, j]), 5)} for j in order[i]]})
        return links
    for i, key in enumerate(keys):
        scored = sorted(((cosine(vectors[i], vectors[j]), keys[j]) for j in range(len(keys)) if j != i), reverse=True)[:top]
        links.append({'id': key, 'nearest': [{'id': k, 'score': round(float(s), 5)} for s, k in scored]})
    return links


# --------------------------------------------------------------------- ECHO
# Faithful port of B's discover.py:842-993. Constants copied verbatim; the only
# structural change is that vocabulary stems + the background model come from the
# JS modules (stem.mjs / background.mjs) via one node batch call, so there is a
# single source of truth and no Python stemmer/background re-implementation.
ECHO_MIN_EPS = 6          # skip if fewer episodes
ECHO_BIG_MIN = 4          # skip if fewer than this many "big" (>=12 msg) episodes
ECHO_BIG_MSGS = 12        # an episode is "big" at this many messages
ECHO_MIN_GAP = 432000     # 5 days between the earlier episode's end and the next start
ECHO_SIM_MIN = 0.55       # cosine floor
ECHO_JAC_MAX = 0.22       # stemmed content-word Jaccard ceiling
ECHO_KPIVOT = 22          # evidence candidate pool per episode
ECHO_MSG_MIN_LEN = 60     # stripped message length must exceed this
ECHO_BEST_K = 3           # best messages per side
ECHO_EVIDENCE_CAP = 8     # evidence list cap
ECHO_LIMIT = 25           # greedy pair-selection limit
ECHO_MAX_TOTAL = 44       # echo is additive but total discoveries stay <= 36 + 8

MARKER_RE = re.compile(r"\[(link|photo|sticker|video|voice|audio|file|animation|"
                       r"video_note|location|poll|contact|fwd)[^\]]*\]")
TOKEN_RE = re.compile(r"[\w']+", re.UNICODE)

RU_STOP = set("""
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы
по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг
ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом
себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам
чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого
какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем
всех никогда можно при наконец два об другой хоть после над больше тот через
эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой
перед иногда лучше чуть том нельзя такой им более всегда конечно всю между
это как бы просто очень такое эта эти этих оно мои твой твоя очень
да нет ок окей вообще типа короче кстати блин ага угу неа хм ммм
""".split())
EN_STOP = set("""
the a an and or but if then than that this these those i you he she it we they
me him her us them my your his its our their to of in on at by for with from
is are was were be been being do does did doing have has had having not no yes
so just very really too also as up out about into over after before what which
who whom when where why how all any both each few more most other some such
only own same can will would should could may might must im ive dont its
ok okay yeah yep nope hey oh ah um uh lol
""".split())
STOP = RU_STOP | EN_STOP


def _strip_markers(s):
    return MARKER_RE.sub(" ", s or "")


def _raw_toks(s):
    """B's `toks`: strip markers, then TOKEN_RE.findall, lowercased."""
    return [w.lower() for w in TOKEN_RE.findall(_strip_markers(s))]


def _content_toks(s):
    """B's `content_toks`: raw tokens minus stopwords/short/digits."""
    return [w for w in _raw_toks(s) if w not in STOP and len(w) > 2 and not w.isdigit()]


# One node subprocess builds stems + the generic-word map from the JS modules.
# argv: node --input-type=module -e <script> <payload.json> <repo-root>
_BRIDGE_SCRIPT = r'''
import fs from "node:fs";
import {pathToFileURL} from "node:url";
const inPath = process.argv[1], root = process.argv[2];
const data = JSON.parse(fs.readFileSync(inPath, "utf8"));
const {stem} = await import(pathToFileURL(root + "/packages/compiler/src/stem.mjs").href);
const {Background} = await import(pathToFileURL(root + "/packages/compiler/src/background.mjs").href);
const bg = new Background(data.episodes.map(e => e.words));
const stems = {};
for (const e of data.episodes) {
  const s = new Set();
  for (const w of e.words) if (w.length > 4) s.add(stem(w));
  stems[e.eid] = [...s].sort();
}
const generic = {};
for (const w of bg.total.keys()) generic[w] = bg.isGeneric(w);
process.stdout.write(JSON.stringify({stems, generic}));
'''


def _stem_background_bridge(episodes, messages, root):
    """Batch-stem every episode's words and build the Background model in one
    node call. Returns ({eid->[sorted stems]}, {word: isGeneric})."""
    payload = {'episodes': []}
    for i, e in enumerate(episodes):
        words = []
        for seq in e.get('message_ids', []):
            if 0 <= seq < len(messages):
                words.extend(_raw_toks(messages[seq].get('text') or ''))
        payload['episodes'].append({'eid': i, 'words': words})
    fd, tmp = tempfile.mkstemp(prefix='echo-bridge-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False)
        proc = subprocess.run(
            ['node', '--input-type=module', '-e', _BRIDGE_SCRIPT, tmp, str(root)],
            capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip()[:400] or 'bridge failed')
        return json.loads(proc.stdout)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _nearest_echo_stage(c, episode_vectors, provider, override):
    """Append echo discoveries to tier0.discoveries. Returns the number appended.
    Caller must run reseal afterwards so integrity covers the new payload."""
    if provider.get('name') == 'mock_local' and not override:
        print('[echo] skipped: mock backend has no semantics')
        return 0
    if np is None:
        print('[echo] skipped: numpy unavailable', file=sys.stderr)
        return 0
    episodes = c.get('tier1', {}).get('episodes', [])
    messages = c.get('tier1', {}).get('messages', [])
    if len(episodes) < ECHO_MIN_EPS:
        return 0
    big = [i for i, e in enumerate(episodes) if len(e.get('message_ids', [])) >= ECHO_BIG_MSGS]
    if len(big) < ECHO_BIG_MIN:
        return 0

    vecs = []
    for i, e in enumerate(episodes):
        v = override.get(f"episode:{e.get('id')}")
        if v is None:
            if i >= len(episode_vectors):
                print('[echo] skipped: episode vectors unavailable', file=sys.stderr)
                return 0
            v = episode_vectors[i]
        vecs.append([float(x) for x in v])
    dim = len(vecs[0])
    if any(len(v) != dim for v in vecs):
        print('[echo] skipped: inconsistent vector dimensions', file=sys.stderr)
        return 0
    V = np.asarray(vecs, dtype=np.float64)
    norms = np.linalg.norm(V, axis=1, keepdims=True); norms[norms == 0] = 1.0
    V = V / norms
    S = V @ V.T

    bridge = _stem_background_bridge(episodes, messages, Path(__file__).resolve().parent.parent)
    stems = [set(bridge['stems'].get(str(i), [])) for i in range(len(episodes))]
    generic = bridge['generic']

    vocab = [stems[i] for i in big]
    Sb = S[np.ix_(big, big)]
    cands = []
    for a in range(len(big)):
        for b in range(a + 1, len(big)):
            ea, eb = episodes[big[a]], episodes[big[b]]
            gap = eb['start'] - ea['end']
            if gap < ECHO_MIN_GAP:
                continue
            sim = float(Sb[a, b])
            if sim < ECHO_SIM_MIN:
                continue
            va, vb = vocab[a], vocab[b]
            if not va or not vb:
                continue
            jac = len(va & vb) / len(va | vb)
            if jac > ECHO_JAC_MAX:
                continue
            cands.append((sim - jac, sim, jac, gap, big[a], big[b]))
    cands.sort(key=lambda x: x[0], reverse=True)
    if not cands:
        return 0

    # Greedy: every episode may anchor at most two echoes (B's `used <= 2`).
    used, chosen = {}, []
    for score, sim, jac, gap, ia, ib in cands:
        if used.get(ia, 0) >= 2 or used.get(ib, 0) >= 2:
            continue
        used[ia] = used.get(ia, 0) + 1
        used[ib] = used.get(ib, 0) + 1
        chosen.append((score, sim, jac, gap, ia, ib))
        if len(chosen) >= ECHO_LIMIT:
            break
    if not chosen:
        return 0

    def pool_for(e):
        seqs = [seq for seq in e.get('message_ids', [])
                if 0 <= seq < len(messages)
                and len(_strip_markers(messages[seq].get('text') or '')) > ECHO_MSG_MIN_LEN]
        seqs.sort(key=lambda s: -len(messages[s].get('text') or ''))
        return seqs[:ECHO_KPIVOT]

    need = sorted({i for *_, a, b in chosen for i in (a, b)})
    msg_index, flat = {}, []
    for i in need:
        seqs = pool_for(episodes[i])
        msg_index[i] = seqs
        for seq in seqs:
            flat.append(_strip_markers(messages[seq].get('text') or '').strip()[:600])

    MV = None
    if flat:
        raw = _embed_corpus(provider, flat)
        MV = np.asarray([[float(x) for x in v] for v in raw], dtype=np.float64)
        if MV.shape[1] != dim:
            print('[echo] skipped: evidence vector dimension mismatch', file=sys.stderr)
            return 0
        mn = np.linalg.norm(MV, axis=1, keepdims=True); mn[mn == 0] = 1.0
        MV = MV / mn
    spans, off = {}, 0
    for i in need:
        n = len(msg_index[i])
        spans[i] = (off, off + n)
        off += n

    out = []
    for score, sim, jac, gap, ia, ib in chosen:
        if MV is None:
            continue
        va, vb = V[ia], V[ib]
        lo_a, hi_a = spans[ia]
        lo_b, hi_b = spans[ib]
        if hi_a <= lo_a or hi_b <= lo_b:
            continue
        sa = MV[lo_a:hi_a] @ vb
        sb = MV[lo_b:hi_b] @ va
        side_a = [int(msg_index[ia][j]) for j in np.argsort(-sa)[:ECHO_BEST_K]]
        side_b = [int(msg_index[ib][j]) for j in np.argsort(-sb)[:ECHO_BEST_K]]
        if not side_a or not side_b:
            continue
        ev = (side_a + side_b)[:ECHO_EVIDENCE_CAP]

        # Name the shared subject from words nearest the midpoint of the two.
        mid = va + vb
        nrm = float(np.linalg.norm(mid))
        mid = mid / nrm if nrm > 0 else mid
        pool = list(range(lo_a, hi_a)) + list(range(lo_b, hi_b))
        topic = ''
        if pool:
            sims = MV[pool] @ mid
            src = flat[pool[int(np.argmax(sims))]]
            words = [w for w in _content_toks(src) if len(w) > 5 and not generic.get(w, True)][:4]
            if words:
                topic = ', '.join(dict.fromkeys(words))

        out.append({
            'id': f'ECHO_{ia}_{ib}',
            'title': f'An echo: {topic} returns',
            'type': 'echo',
            'score': round(float(sim - jac), 3),
            'evidence': ev,
            'status': 'DERIVED',
            'episodes': [ia, ib],
            'meta': {'similarity': float(sim), 'lexical_overlap': float(jac),
                     'days_apart': int(gap / 86400), 'topic': topic},
        })

    discoveries = c.setdefault('tier0', {}).setdefault('discoveries', [])
    out = out[:max(0, ECHO_MAX_TOTAL - len(discoveries))]
    discoveries.extend(out)
    # Ids must stay unique (existing + ECHO_*): fail-closed dedupe, never slicing.
    seen, uniq = set(), []
    for d in discoveries:
        if d['id'] in seen:
            continue
        seen.add(d['id']); uniq.append(d)
    c['tier0']['discoveries'] = uniq
    if out:
        print(f'[echo] appended {len(out)} echo discoveries')
    return len(out)


def main():
    if len(sys.argv) < 2:
        print('usage: embed_cpu.py public/cartridge.json', file=sys.stderr); raise SystemExit(2)
    path = Path(sys.argv[1])
    c = json.loads(path.read_text(encoding='utf-8'))
    episodes = [(f'episode:{e["id"]}', f"Episode {e['id']} {' '.join(e.get('themes', []))}: {e.get('summary','')}") for e in c.get('tier1', {}).get('episodes', [])]
    discoveries = [(d['id'], d['title']) for d in c.get('tier0', {}).get('discoveries', [])]
    items = episodes + discoveries
    keys = [k for k, _ in items]

    chain = []
    if os.environ.get('EMBED_MOCK') == '1':
        os.environ.setdefault('MOCK_KEY', 'mock')
        srv, port = fe.run_mock_server()
        chain.append(fe.make_mock_provider(port))
    else:
        if os.environ.get('LOCAL_ONLY') == '1':
            chain = []
        else:
            chain = list(fe.PROVIDERS)
        if fe._local_available():
            chain.append({'name': f'local({fe._LOCAL.engine})', '_local': True, 'model': fe._LOCAL_MODEL})
    if not chain:
        print('No embedding backend available: set a provider key (SILICONFLOW_KEY/NVIDIA_NIM_KEY/GEMINI_KEY), install fastembed, or use EMBED_MOCK=1.', file=sys.stderr)
        raise SystemExit(3)

    texts = [t for _, t in items]
    last_error = None
    for provider in chain:
        label = provider['model'] if provider.get('_local') else f'{provider["name"]}:{provider["model"]}'
        try:
            vectors = _embed_corpus(provider, texts)
            print(f'Embedded {len(texts)} items via {label}')
            break
        except Exception as exc:
            last_error = exc
            print(f'[skip] {label}: {exc}', file=sys.stderr)
            vectors = None
    if vectors is None:
        print(f'All embedding backends failed: {last_error}', file=sys.stderr)
        raise SystemExit(4)

    # ECHO enrichment must run BEFORE the merge+reseal below so the reseal covers
    # the appended tier0.discoveries.
    echo_override = {}
    _ov = os.environ.get('ECHO_VEC_FILE')
    if _ov:
        echo_override = json.loads(Path(_ov).read_text(encoding='utf-8'))
    _nearest_echo_stage(c, vectors, provider, echo_override)

    links = _nearest_links(vectors, keys)
    ep_ids = {k for k, _ in episodes}
    sem = c.setdefault('tier1', {}).setdefault('search', {}).setdefault('semantic', {})
    sem['cpu_embedding_model'] = label
    sem['embedding_links'] = [x for x in links if x['id'] not in ep_ids]
    sem['episode_embedding_links'] = [x for x in links if x['id'] in ep_ids]
    c.setdefault('integrity', {})['cpu_embeddings'] = {'model': label, 'items': len(items)}
    path.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding='utf-8')
    reseal = str(Path(__file__).resolve().parent / 'reseal-cartridge.mjs')
    subprocess.run(['node', reseal, str(path)], check=True)
    # The reseal changed the cartridge payload (semantic links + echo discoveries),
    # so the sharded-boot artifact must be regenerated from the new manifests.
    rebuild = str(Path(__file__).resolve().parent / 'rebuild-shards.mjs')
    if os.path.exists(rebuild):
        subprocess.run(['node', rebuild, str(path)], check=True)
    print(f'Merged semantic links for {len(items)} items into {path}')


if __name__ == '__main__':
    main()
