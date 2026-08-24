#!/usr/bin/env python3
"""Optional CPU semantic enrichment. Merges precomputed nearest-neighbour links into the cartridge."""
import json,sys
from pathlib import Path
MODEL='Qwen/Qwen3-Embedding-0.6B'
def cosine(a,b):
    dot=sum(x*y for x,y in zip(a,b)); na=sum(x*x for x in a)**0.5; nb=sum(y*y for y in b)**0.5
    return dot/(na*nb) if na and nb else 0.0
def main():
    if len(sys.argv)<2: print('usage: embed_cpu.py public/cartridge.json [model]',file=sys.stderr); raise SystemExit(2)
    path=Path(sys.argv[1]); model_name=sys.argv[2] if len(sys.argv)>2 else MODEL
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:
        print('Missing sentence-transformers/torch. This optional stage is CPU-only.',file=sys.stderr);print(exc,file=sys.stderr);raise SystemExit(3)
    c=json.loads(path.read_text(encoding='utf-8'));episodes=[];discoveries=[]
    for e in c.get('tier1',{}).get('episodes',[]):episodes.append((f'episode:{e["id"]}',f"Episode {e['id']} {' '.join(e.get('themes',[]))}: {e.get('summary','')}"))
    for d in c.get('tier0',{}).get('discoveries',[]):discoveries.append((d['id'],d['title']))
    items=episodes+discoveries
    model=SentenceTransformer(model_name,device='cpu'); vec=model.encode([t for _,t in items],normalize_embeddings=True,batch_size=16,show_progress_bar=True)
    links=[]
    for i,(key,_) in enumerate(items):
        scored=sorted(((cosine(vec[i],vec[j]),items[j][0]) for j in range(len(items)) if j!=i),reverse=True)[:5]
        links.append({'id':key,'nearest':[{'id':k,'score':round(float(s),5)} for s,k in scored]})
    ep_ids={k for k,_ in episodes};
    d_links=[x for x in links if x['id'] not in ep_ids]
    e_links=[x for x in links if x['id'] in ep_ids]
    sem=c.setdefault('tier1',{}).setdefault('search',{}).setdefault('semantic',{});sem['cpu_embedding_model']=model_name;sem['embedding_links']=d_links;sem['episode_embedding_links']=e_links
    c.setdefault('integrity',{})['cpu_embeddings']={'model':model_name,'items':len(items)}
    path.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
    import subprocess
    subprocess.run(['node','tools/reseal-cartridge.mjs',str(path)],check=True)
    print(f'Merged CPU semantic links for {len(items)} items into {path}')
if __name__=='__main__':main()
