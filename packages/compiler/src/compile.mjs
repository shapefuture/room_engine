import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {isMainThread} from 'node:worker_threads';
import os from 'node:os';
import { encodeCanonicalMessages } from '../../shared/src/gcf.mjs';
import { emitIndex, emitMap, packRoot } from '../../shared/src/gcf-sidecar.mjs';
import { buildShards } from '../../shared/src/runtime-core.mjs';
import { makeEpisodes } from './episodes.mjs';
import { tokens } from '../../shared/src/tokens.mjs';

const CLASSES = ['language','humour','curiosity','value','evolution','memory','lore','relationship','influence','contradiction','invariant','emergence','echo'];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const sha256=(v)=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function normalizeText(text,entities){const parts=Array.isArray(text)?text.map(x=>typeof x==='string'?{type:'plain',text:x,href:null}:{type:x?.type??'plain',text:x?.text??'',href:x?.href??null}):[{type:'plain',text:String(text??''),href:null}];const links=[];const seenHost=new Set();const addLink=u=>{const key=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return 'web'}};const host=key(u);if(seenHost.has(host))return;seenHost.add(host);links.push({type:'link',host});};for(const e of(Array.isArray(entities)?entities:[])){const t=e?.text??'',u=e?.href??(e?.type==='link'||e?.type==='text_link'?t:'');if(/^https?:\/\//i.test(u))addLink(u);}let norm='';const spans=[];for(const part of parts){for(const m of String(part.text).matchAll(/https?:\/\/\S+/g))addLink(m[0]);const chunk=String(part.text).replace(/https?:\/\S+/g,' [link] ').replace(/\s+/g,' ').trim();if(!chunk)continue;const start=norm.length;norm+=chunk;if(part.type!=='plain')spans.push([start,start+chunk.length,part.type,part.href??null]);norm+=' ';}return{text:norm.trimEnd(),spans,links};}
function getParticipants(chat,roles={}){const m=new Map();for(const x of chat.messages??[]){const id=String(x.from_id??x.from??'unknown');const name=String(x.from??id).replace(/\s*[❤️🔥]+.*$/u,'').trim();if(!m.has(id)){const role=roles[id]??roles[name]??`P${m.size}`;m.set(id,{id:m.size,source_id:id,name,role});}}return[...m.values()];}
function parseChats(raw){if(Array.isArray(raw))return raw;if(raw&&Array.isArray(raw.chats))return raw.chats;if(raw?.messages)return[raw];return[];}
function salience(msg,prev,toks){let s=.12+Math.min(.22,msg.text.length/1200);if(toks.length)s+=Math.min(.18,new Set(toks).size/toks.length);if(msg.spans?.length)s+=.12;if(/[?？]/u.test(msg.text))s+=.12;if(msg.r!=null)s+=.08;if(msg.reactions?.length)s+=Math.min(.08,msg.reactions.length*.02);if(prev&&Math.abs(msg.t-prev.t)>3600)s+=.06;if(/[🤣😂😱❤❤️🔥😉🙃!]/u.test(msg.text))s+=.04;return Number(clamp(s).toFixed(4));}
function makeIndex(messages){const index={};for(const m of messages)for(const t of (m._toks??tokens(m.text))){(index[t]??=[]).push(m.seq);}return index;}
function phraseStats(messages){const p=new Map();for(const m of messages){const seen=new Set();for(const t of (m._toks??tokens(m.text)).filter(x=>x.length>=4)){if(seen.has(t))continue;seen.add(t);const v=p.get(t)??{count:0,first:m.t,last:m.t,speakers:new Set(),ids:[]};v.count++;v.first=Math.min(v.first,m.t);v.last=Math.max(v.last,m.t);v.speakers.add(m.p);v.ids.push(m.seq);p.set(t,v);}}return p;}
function ev(id,title,type,score,evidence,status='DERIVED',extra={}){return{id,title,type,score:Number(clamp(score).toFixed(3)),evidence:[...new Set(evidence)].slice(0,12),status,...extra};}
function makeCandidates(messages,episodes){const stats=phraseStats(messages), out=[];
  const tokOf=m=>m._toks??tokens(m.text);
  for(const [word,v] of [...stats.entries()].filter(([_,v])=>v.count>=3).sort((a,b)=>b[1].count-a[1].count).slice(0,12))out.push(ev(`L_${word}`,`The word “${word}” keeps returning`,'language',Math.min(1,v.count/12),v.ids));
  for(const m of messages.filter(x=>x.reactions?.length&&x.reactions.some(r=>/😂|🤣|😁|😆|😹/u.test(r))).sort((a,b)=>b.salience-a.salience).slice(0,8))out.push(ev(`H_${m.seq}`,'A reliably funny moment','humour',m.salience+.15,[m.seq],'OBSERVED'));
  for(const e of episodes.filter(e=>e.message_ids.some(id=>/[?？]/u.test(messages[id]?.text??''))).sort((a,b)=>b.message_ids.length-a.message_ids.length).slice(0,8))out.push(ev(`C_${e.id}`,`Question trail ${e.id}`,'curiosity',Math.min(1,e.message_ids.filter(id=>/[?？]/u.test(messages[id]?.text??'')).length/4)+.25,e.representative));
  for(const [word,v] of [...stats.entries()].filter(([_,v])=>v.count>=3&&v.last-v.first>=7*86400).sort((a,b)=>(b[1].last-b[1].first)-(a[1].last-a[1].first)).slice(0,8))out.push(ev(`E_${word}`,`The long life of “${word}”`,'evolution',Math.min(1,(v.last-v.first)/(365*86400)),v.ids,'DERIVED',{first:v.first,last:v.last}));
  for(const e of episodes.filter(e=>e.message_ids.length>=4).sort((a,b)=>b.message_ids.length-a.message_ids.length).slice(0,8))out.push(ev(`LORE_${e.id}`,`A durable chapter: ${e.id}`,'lore',Math.min(1,e.message_ids.length/20),e.representative));
  // Evidence-backed value/memory/influence/relationship hypotheses are deterministic and explicitly provisional.
  const participants=[...new Set(messages.map(m=>m.p))];
  for(const [word,v] of [...stats.entries()].filter(([w,v])=>v.count>=4&&v.speakers.size===1).slice(0,6)){out.push(ev(`V_${word}`,`A recurring preference around “${word}”`,'value',Math.min(1,v.count/14),v.ids,'INTERPRETED',{speaker_only:true}));}
  for(const [word,v] of [...stats.entries()].filter(([w,v])=>v.count>=4&&v.last-v.first>=30*86400).sort((a,b)=>b[1].count-a[1].count).slice(0,6))out.push(ev(`M_${word}`,`A memory anchor: “${word}”`,'memory',Math.min(1,(v.last-v.first)/(180*86400)),v.ids));
  if(participants.length>=2){for(const [word,v] of [...stats.entries()].filter(([w,v])=>v.count>=2&&v.speakers.size>=2).sort((a,b)=>b[1].count-a[1].count).slice(0,8))out.push(ev(`R_${word}`,`A shared language around “${word}”`,'relationship',Math.min(1,.35+v.speakers.size/participants.length*.55),v.ids,'DERIVED',{speakers:[...v.speakers]}));
    for(const e of episodes.filter(e=>e.participants.length>=2)){const local=new Map();let replies=0;for(const id of e.message_ids){const m=messages[id];if(m.r!=null)replies++;for(const t of tokOf(m).filter(x=>x.length>=4)){const s=local.get(t)??new Set();s.add(m.p);local.set(t,s);}}const shared=[...local.entries()].filter(([_,s])=>s.size>=2).map(([t])=>t).slice(0,6);if(shared.length){const sharedRatio=Math.min(1,shared.length/4);const replyRatio=Math.min(1,replies/Math.max(1,e.message_ids.length));const crossVoice=Math.min(1,e.participants.length/2);const score=.35+.35*sharedRatio+.20*replyRatio+.10*crossVoice;out.push(ev(`TM_${e.id}`,`A shared pattern around: ${shared.join(', ')}`,'emergence',score,e.representative,'DERIVED',{category:'RELATIONALLY_SPECIFIC',shared_terms:shared,speakers:e.participants,reply_ratio:Number(replyRatio.toFixed(3))}));}}
  }
  const qMsgs=messages.filter(m=>/[?？]/u.test(m.text)).map(m=>m.seq); if(qMsgs.length>=2)out.push(ev('I_questions','Questions are part of the archive’s shape','invariant',Math.min(1,.45+qMsgs.length/messages.length),qMsgs,'INTERPRETED'));
  for(const [word,v] of [...stats.entries()].filter(([_,v])=>v.speakers.size===1&&v.count>=3&&v.last-v.first>7*86400).slice(0,4))out.push(ev(`INF_${word}`,`A pattern carried more strongly by one voice: “${word}”`,'influence',Math.min(1,.3+v.count/20),v.ids,'INTERPRETED',{speaker_only:true}));
  const contradictionWords=['never','always','hate','love','dont','нет','никогда','всегда','люблю','ненавижу']; for(const t of contradictionWords){const hits=messages.filter(m=>tokOf(m).includes(t));if(hits.length>=2)out.push(ev(`X_${t}`,`A tension around “${t}”`,'contradiction',Math.min(1,.35+hits.length/12),hits.map(m=>m.seq),'INTERPRETED'));}
  return dedupeCandidates(out.sort((a,b)=>CLASS_PRIORITY[a.type]-CLASS_PRIORITY[b.type]));
}
function dedupeCandidates(items){const seen=new Set();return items.filter(d=>{if(seen.has(d.id))return false;seen.add(d.id);return CLASSES.includes(d.type);});}
// Cross-voice classes must claim discovery slots before bulk single-voice ones,
// or large archives fill the cap with "word keeps returning" candidates and the
// Semantic Door can never open. Selection interleaves classes round-robin in
// priority order so the cap always holds a diverse, high-value mix.
// 'echo' is enrichment-stage-only (embed_cpu.py) and never selected here.
const CLASS_PRIORITY={emergence:0,relationship:1,humour:2,curiosity:3,lore:4,memory:5,evolution:6,contradiction:7,invariant:8,value:9,influence:10,language:11};
function selectDiscoveries(items,cap=36){const byType=new Map();for(const d of items){if(!byType.has(d.type))byType.set(d.type,[]);byType.get(d.type).push(d);}const order=[...byType.keys()].sort((a,b)=>(CLASS_PRIORITY[a]??99)-(CLASS_PRIORITY[b]??99));const out=[];while(out.length<cap){let added=false;for(const t of order){const list=byType.get(t);if(list?.length){out.push(list.shift());added=true;if(out.length>=cap)break;}}if(!added)break;}return out;}
function semanticModel(index,candidates){const byTerm={};for(const d of candidates){const qs=tokens(`${d.title} ${d.type} ${d.shared_terms?.join(' ')??''}`);const ids=new Set();for(const q of qs)for(const id of index[q]??[])ids.add(id);byTerm[d.id]=[...ids].slice(0,40);}return {v:3,discovery_hits:byTerm};}
function contentProjection(cartridge){const clone=structuredClone(cartridge);delete clone.integrity;return clone;}
function integrityManifest(cartridge){return sha256(contentProjection(cartridge));}

// ---- per-message transform (shared by the sequential and worker-parallel paths) ----
export function transformMessage(m,seq,p){const norm=normalizeText(m.text,m.text_entities),reactions=(m.reactions??[]).map(r=>r.emoji??r.type??'reaction');const x={seq,_telegram_id:m.id,p,t:Number(m.date_unixtime??Math.floor(new Date(m.date).getTime()/1000)),r:m.reply_to_message_id??null,text:norm.text,spans:norm.spans.length?norm.spans:undefined,links:norm.links.length?norm.links:undefined,media:m.media_type??(m.photo?'photo':m.file?'file':undefined),reactions:reactions.length?reactions:undefined};const prov={seq,telegram_id:m.id,source_hash:sha256(m),edited:!!m.edited,forwarded:!!m.forwarded_from,has_media:!!m.media_type||!!m.photo||!!m.file};return {x,prov};}

async function transformAll(rawMessages,pmapEntries,parallelMin){
  const pmap=new Map(pmapEntries);const p=id=>pmap.get(String(id??'unknown'))??0;
  if(rawMessages.length>=parallelMin){
    const {Worker}=await import('node:worker_threads');
    const W=Math.max(1,Math.min((os.cpus().length-1)||1,8));
    const size=Math.ceil(rawMessages.length/W);const workerUrl=new URL('./compile-worker.mjs',import.meta.url);
    const jobs=[];for(let w=0;w<W;w++){const slice=rawMessages.slice(w*size,(w+1)*size);if(!slice.length){jobs.push(Promise.resolve([]));continue;}
      jobs.push(new Promise((res,rej)=>{const worker=new Worker(workerUrl);worker.on('error',rej);worker.on('message',rows=>{res(rows);worker.terminate();});worker.postMessage({slice,pmapEntries,startSeq:w*size});}));}
    const parts=await Promise.all(jobs);return parts.flat();
  }
  return rawMessages.map((m,seq)=>{const {x,prov}=transformMessage(m,seq,p(m.from_id??m.from));x._toks=tokens(x.text);return {x,prov,toks:x._toks};});
}

export async function compileTelegram(raw,options={}){const chats=parseChats(raw);const chat=chats[0]??{name:'The Room of Us',type:'personal_chat',id:0,messages:[]};const participantRows=getParticipants(chat,options.roles??{}), rawMessages=Array.isArray(chat.messages)?chat.messages:[];
  const rows=await transformAll(rawMessages,participantRows.map(p=>[p.source_id,p.id]),options.parallelMin??Number(process.env.ROU_PARALLEL_MIN??50000));
  const messages=rows.map(r=>r.x);let prev=null;for(let i=0;i<messages.length;i++){messages[i]._toks=rows[i].toks;messages[i].salience=salience(messages[i],prev,messages[i]._toks);prev=messages[i];}
  const map=new Map(messages.map(m=>[String(m._telegram_id),m.seq]));for(const m of messages)m.r=m.r==null?null:map.get(String(m.r))??null;
  const runtimeMessages=messages.map(({seq,p,t,r,text,spans,links,media,reactions})=>({seq,p,t,r,text,...(spans?{spans}:{}),...(links?{links}:{}),...(media?{media}:{}),...(reactions?{reactions}:{})}));
  const episodes=makeEpisodes(messages), candidates=makeCandidates(messages,episodes), provenanceRows=rows.map(r=>r.prov), searchIndex=makeIndex(messages), model=semanticModel(searchIndex,candidates);
  const ranked=[...runtimeMessages].sort((a,b)=>messages[b.seq].salience-messages[a.seq].salience);
  const sample=(runtimeMessages.filter(m=>messages[m.seq].salience>=.65).length?runtimeMessages.filter(m=>messages[m.seq].salience>=.65):ranked).slice(0,120);
  const digest=sha256(raw);
  const runtimeManifest=sha256(JSON.stringify(runtimeMessages.map(({seq,p,t,r,text})=>({seq,p,t,r,text}))));
  const provenanceManifest=sha256(JSON.stringify(provenanceRows));
  const discoveries=selectDiscoveries(candidates);
  const cartridge={version:4,schema:'room-of-us/v2',source:{kind:'telegram',chat_id:chat.id,name:chat.name,corpus_digest:digest,...(options.truncated?{truncated_bytes:options.truncated}:{})},chat:{id:chat.id,name:chat.name,type:chat.type,message_count:messages.length,episode_count:episodes.length,...(options.truncated?{truncated:true}:{})},participants:participantRows.map(({source_id,...p})=>p),tier0:{room:{title:'THE ROOM OF US'},discoveries,third_mind:discoveries.filter(x=>x.type==='emergence').slice(0,8)},tier1:{episodes,messages:runtimeMessages,search:{index:searchIndex,sample,semantic:model}},provenance:{messages:provenanceRows}};
  const uniqueEvidence=new Set(discoveries.flatMap(d=>d.evidence));
  cartridge.integrity={provenance_records:provenanceRows.length,evidence_records:uniqueEvidence.size,semantic_candidates:cartridge.tier0.discoveries.length,runtime_manifest:runtimeManifest,provenance_manifest:provenanceManifest,content_manifest:integrityManifest(cartridge)};
  return {cartridge,canonical:messages,episodes,participants:participantRows,provenance:provenanceRows};}

// ---- truncation recovery + original-source byte-range scanning (gcfc-style) ----
// Single byte-scan over the raw export buffer: records every "messages" array and
// the byte range of each complete record object inside it. If the JSON is
// truncated, the last complete record + the open-bracket stack reconstruct a
// parseable document (mirrors gcfc's salvage semantics; --strict refuses).
export function scanSource(buf){
  const arrays=[];let active=-1,inString=false,escaped=false,recStart=-1;
  const stack=[];let lastEnd=-1,lastClosers='';
  const WS=c=>c===0x20||c===0x09||c===0x0a||c===0x0d;
  for(let i=0;i<buf.length;i++){const c=buf[i];
    if(inString){if(escaped)escaped=false;else if(c===0x5c)escaped=true;else if(c===0x22)inString=false;continue;}
    if(c===0x22){
      if(buf[i+1]===0x6d&&buf[i+2]===0x65&&buf[i+3]===0x73&&buf[i+4]===0x73&&buf[i+5]===0x61&&buf[i+6]===0x67&&buf[i+7]===0x65&&buf[i+8]===0x73&&buf[i+9]===0x22){
        let j=i+10;while(j<buf.length&&WS(buf[j]))j++;
        if(buf[j]===0x3a){j++;while(j<buf.length&&WS(buf[j]))j++;
          if(buf[j]===0x5b){stack.push('[');arrays.push({openDepth:stack.length,records:[]});active=arrays.length-1;recStart=-1;i=j;continue;}}
      }
      inString=true;continue;}
    if(c===0x7b){stack.push('{');if(active>=0&&recStart<0)recStart=i;continue;}
    if(c===0x5b){stack.push('[');continue;}
    if(c===0x7d||c===0x5d){const open=stack.pop();
      if(active>=0&&open==='{'&&recStart>=0&&stack.length===arrays[active].openDepth){
        arrays[active].records.push({off:recStart,len:i+1-recStart});lastEnd=i+1;
        lastClosers=[...stack].reverse().map(ch=>ch==='['?']':'}').join('');recStart=-1;}
      else if(active>=0&&open==='['&&stack.length===arrays[active].openDepth-1){active=-1;}
      continue;}}
  return {arrays,lastEnd,lastClosers};
}
export function parseWithRecovery(buf,{strict=false}={}){
  const text=buf.toString('utf8');
  try{return {raw:JSON.parse(text),truncated:false};}catch(e){if(strict)throw new Error(`strict mode: source JSON is truncated/malformed (${e.message})`);}
  const scan=scanSource(buf);
  if(scan.lastEnd<=0)throw new Error('unrecoverable JSON input: no complete message record found');
  const salvaged=buf.slice(0,scan.lastEnd).toString('utf8')+scan.lastClosers;
  const raw=JSON.parse(salvaged);
  return {raw,truncated:true,dropped:buf.length-scan.lastEnd};
}

// ---- CLI ----
if(isMainThread && process.argv[1] && path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1])){
  (async()=>{
    const input=process.argv[2],output=process.argv[3]??'public/cartridge.json';
    if(!input){console.error('Usage: node compile.mjs input.json [output.json] [--role=A=X] [--strict] [--shards=N] [--no-sidecars]');process.exit(2);}
    const roles={};let strict=false,shards=4096,sidecars=true;
    for(const arg of process.argv.slice(4)){
      if(arg.startsWith('--role=')){const value=arg.slice(7),eq=value.lastIndexOf('=');if(eq>0)roles[value.slice(0,eq)]=value.slice(eq+1);}
      else if(arg==='--strict')strict=true;
      else if(arg.startsWith('--shards='))shards=Number(arg.slice(9));
      else if(arg==='--no-sidecars')sidecars=false;
    }
    const buf=fs.readFileSync(input);
    const sourceSha256=crypto.createHash('sha256').update(buf).digest('hex');
    const scan=scanSource(buf);
    const parsed=parseWithRecovery(buf,{strict});
    if(parsed.truncated)console.warn(`Source was truncated: salvaged ${scan.lastEnd} of ${buf.length} bytes (dropped ${parsed.dropped}); cartridge flagged truncated=true.`);
    const r=await compileTelegram(parsed.raw,{roles,truncated:parsed.truncated?parsed.dropped:undefined});
    const outDir=path.dirname(output);fs.mkdirSync(outDir,{recursive:true});
    fs.writeFileSync(output,JSON.stringify(r.cartridge,null,2));
    const gcfPath=output.replace(/\.json$/i,'.gcf');
    const gcfText=encodeCanonicalMessages(r.canonical);
    fs.writeFileSync(gcfPath,gcfText);
    let sidecarNote='sidecars skipped';
    if(sidecars){
      const enc=new TextEncoder();const lines=gcfText.split('\n');const bl=s=>enc.encode(s).length;
      let sectionOffset=bl(lines[0])+1,anchorBase=sectionOffset+bl(lines[1])+1;
      const anchors=[];let pos=anchorBase;
      for(let i=0;i<r.canonical.length;i++){if(i%64===0)anchors.push({m:i,offset:pos,t:r.canonical[i].t});pos+=bl(lines[2+i])+1;}
      const t0=r.canonical[0]?.t??0,t1=r.canonical.at(-1)?.t??0;
      fs.writeFileSync(output.replace(/\.json$/i,'.idx.gcf'),emitIndex({stride:64,sections:[{name:'messages',first:0,count:r.canonical.length,offset:sectionOffset,t0,t1}],anchors}));
      const recs=scan.arrays[0]?.records;
      if(recs&&recs.length===(r.canonical.length)){ // original-source byte provenance per message
        const chat0=(Array.isArray(parsed.raw)?parsed.raw[0]:(parsed.raw?.chats?.[0]??parsed.raw))??{};
        const rawMsgs=chat0.messages??[];
        const rowsMap=recs.map((rec,i)=>({m:i,tg:rawMsgs[i]?.id??i,off:rec.off,len:rec.len,date:rawMsgs[i]?.date??''}));
        const root=await packRoot(rowsMap);
        fs.writeFileSync(output.replace(/\.json$/i,'.map.gcf'),emitMap({sourceFile:path.basename(input),sourceSha256,rows:rowsMap,packRoot:root}));
        sidecarNote='idx+map sidecars written';
      }else{sidecarNote='idx written; map skipped (source ranges not aligned — input not raw Telegram export bytes)';}
    }
    let shardNote='sharding off';
    if(shards>0){
      const {core,shards:files}=await buildShards(r.cartridge,shards);
      const partsDir=path.join(outDir,'cartridge-parts');
      fs.rmSync(partsDir,{recursive:true,force:true});fs.mkdirSync(partsDir,{recursive:true});
      fs.writeFileSync(path.join(partsDir,'core.json'),JSON.stringify(core,null,2));
      for(const f of files)fs.writeFileSync(path.join(partsDir,f.file),f.text);
      shardNote=`${files.length} shards -> ${partsDir}`;
    }
    console.log(`Wrote ${output} (${r.cartridge.chat.message_count} messages${parsed.truncated?', TRUNCATED':''}); ${sidecarNote}; ${shardNote}`);
  })().catch(e=>{console.error(e.message);process.exit(1);});
}
