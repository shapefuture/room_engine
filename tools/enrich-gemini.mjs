import fs from 'node:fs';
const [, , input='public/cartridge.json', output=input] = process.argv;
if(!process.env.GEMINI_API_KEY){console.error('Set GEMINI_API_KEY. External enrichment is opt-in.');process.exit(2);}
if(!process.argv.includes('--allow-external')){console.error('Refusing external transmission without --allow-external.');process.exit(2);}
const model=process.env.GEMINI_MODEL||'gemini-3.7-flash';
const ALLOWED=new Set(['language','humour','curiosity','value','evolution','memory','lore','relationship','influence','contradiction','invariant','emergence']);
const STATUS=new Set(['OBSERVED','DERIVED','INTERPRETED']);
const c=JSON.parse(fs.readFileSync(input,'utf8'));
const episodes=(c.tier1?.episodes||[]).slice(0,400).map(e=>({id:e.id,start:e.start,end:e.end,participants:e.participants,themes:e.themes,summary:e.summary,representative:e.representative}));
const prompt=`Compile evidence-backed private friendship discoveries. Return JSON array only. Allowed types: language|humour|curiosity|value|evolution|memory|lore|relationship|influence|emergence|contradiction|invariant. Each item: id,title,type,status,confidence,evidence_episode_ids,counterevidence_needed,why_surprising. Never invent evidence or names; use multiple episodes where possible.\nEPISODES:\n${JSON.stringify(episodes)}`;
const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.2,maxOutputTokens:8000}})});
if(!res.ok)throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
const body=await res.json();const text=body.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';let rows;try{rows=JSON.parse(text);}catch{throw new Error('Gemini did not return JSON');}
const byEpisode=new Map((c.tier1?.episodes||[]).map(e=>[e.id,e]));const existingIds=new Set((c.tier0?.discoveries||[]).map(d=>d.id));const additions=[];
for(const x of Array.isArray(rows)?rows:[]){if(!x||!ALLOWED.has(String(x.type||'')))continue;if(x.status&&!STATUS.has(String(x.status)))continue;const eps=(x.evidence_episode_ids||[]).map(id=>byEpisode.get(id)).filter(Boolean);const evidence=[...new Set(eps.flatMap(e=>e.representative))];if(!evidence.length)continue;const id=String(x.id||`AI_${additions.length}`);if(existingIds.has(id))continue;additions.push({id,title:String(x.title||'Untitled'),type:String(x.type||'lore'),score:Number(Math.max(0,Math.min(1,x.confidence??0))),evidence,status:String(x.status||'INTERPRETED'),category:x.type==='emergence'?'RELATIONALLY_SPECIFIC':undefined,external:{model,why_surprising:x.why_surprising??'',counterevidence_needed:!!x.counterevidence_needed}});}
c.tier0.discoveries=[...(c.tier0.discoveries||[]),...additions].slice(0,60);c.integrity.semantic_candidates=c.tier0.discoveries.length;c.integrity.evidence_records=new Set(c.tier0.discoveries.flatMap(d=>d.evidence)).size;c.tier0.third_mind=c.tier0.discoveries.filter(d=>d.type==='emergence').slice(0,8);c.integrity.external_enrichment={model,count:additions.length,created_at:new Date().toISOString()};fs.writeFileSync(output,JSON.stringify(c,null,2));
const {spawnSync}=await import('node:child_process');const seal=spawnSync(process.execPath,['tools/reseal-cartridge.mjs',output],{stdio:'inherit'});if(seal.status!==0)process.exit(seal.status??1);
console.log(`Merged ${additions.length} evidence-backed external candidates into ${output}`);
