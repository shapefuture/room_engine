import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileTelegram} from '../packages/compiler/src/compile.mjs';
import {verifyCartridge,bootCartridge} from '../packages/shared/src/runtime-core.mjs';
import {encodeCanonicalMessages} from '../packages/shared/src/gcf.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const raw=JSON.parse(read('data/demo/telegram.json'));const compiled=await compileTelegram(raw,{roles:{Viktor:'HIM',Friend:'HER'}});const c=compiled.cartridge;
assert.ok(c.chat.message_count>0);
assert.ok(c.tier1.search.semantic&&typeof c.tier1.search.semantic.discovery_hits==='object');
assert.ok(c.tier0.discoveries.length>0);
assert.ok(c.tier0.discoveries.every(d=>d.evidence.length>0));
assert.ok(c.tier0.discoveries.every(d=>['language','humour','curiosity','value','evolution','memory','lore','relationship','influence','contradiction','invariant','emergence','echo'].includes(d.type)));
assert.ok(c.tier0.discoveries.filter(d=>d.type==='emergence').every(d=>d.shared_terms?.length&&d.speakers?.length>=2));
assert.equal(c.integrity.provenance_records,c.chat.message_count);
assert.equal(c.integrity.evidence_records,new Set(c.tier0.discoveries.flatMap(d=>d.evidence)).size);
assert.equal(c.integrity.semantic_candidates,c.tier0.discoveries.length);
await verifyCartridge(c);
const tmp=await fsPromises.mkdtemp(path.join(os.tmpdir(),'room-of-us-gauntlet-'));await fsPromises.writeFile(path.join(tmp,'cartridge.json'),JSON.stringify(c));await fsPromises.writeFile(path.join(tmp,'cartridge.gcf'),encodeCanonicalMessages(c.tier1.messages));
const fileFetch=async url=>{const name=url.endsWith('.gcf')?'cartridge.gcf':'cartridge.json';const body=await fsPromises.readFile(path.join(tmp,name),'utf8');return {ok:true,status:200,json:async()=>JSON.parse(body),text:async()=>body};};
const booted=await bootCartridge(fileFetch);assert.equal(booted.chat.message_count,c.chat.message_count);
const noOverlap={name:'Negative',type:'personal_chat',id:9,messages:[{id:1,date_unixtime:'100',from:'A',from_id:'a',text:'quantum mechanics?'},{id:2,date_unixtime:'101',from:'B',from_id:'b',text:'blueberry pancakes'},{id:3,date_unixtime:'102',from:'A',from_id:'a',text:'Schrodinger'},{id:4,date_unixtime:'103',from:'B',from_id:'b',text:'mountain bicycles'}]};const neg=await compileTelegram(noOverlap);assert.equal(neg.cartridge.tier0.discoveries.some(d=>d.type==='emergence'),false);assert.equal(neg.cartridge.tier0.third_mind.length,0);
const before=structuredClone(c);before.tier0.discoveries.push({id:'AI_TEST',title:'AI evidence test',type:'relationship',score:.6,evidence:[0],status:'INTERPRETED'});const tmpJson=path.join(tmp,'reseal.json');await fsPromises.writeFile(tmpJson,JSON.stringify(before));const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['tools/reseal-cartridge.mjs',tmpJson],{stdio:'ignore'});const resealed=JSON.parse(await fsPromises.readFile(tmpJson,'utf8'));assert.equal(resealed.integrity.evidence_records,new Set(resealed.tier0.discoveries.flatMap(d=>d.evidence)).size);assert.equal(resealed.integrity.semantic_candidates,resealed.tier0.discoveries.length);await verifyCartridge(resealed);
const tampered=structuredClone(c);tampered.tier0.discoveries[0].title+=' tamper';const payload=structuredClone(tampered);delete payload.integrity;const tamperedDigest=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');assert.notEqual(tamperedDigest,c.integrity.content_manifest);
assert.ok(c.participants.every(p=>p.name&&p.role));assert.equal(c.participants.find(p=>p.name==='Viktor')?.role,'HIM');assert.equal(c.participants.find(p=>p.name==='Friend')?.role,'HER');
assert.ok((raw[0]?.messages?.length??0)>0);assert.ok(compiled.cartridge.tier1.search.sample.length>0);
const source=read('apps/room/src/main.ts');assert.ok(source.includes('bootCartridge(fetch'));assert.ok(source.includes('rich spans:'));assert.ok(source.includes('AI source:'));assert.ok(source.includes('participantLabel'));assert.ok(!source.includes("fetch('/demo-cartridge.json"));assert.ok(!source.includes('const STOP='));assert.ok(!source.includes('function msgMap'));assert.ok(!source.includes('function displayName'));assert.ok(!source.includes('function gcfDecodeCanonical'));
const pkg=JSON.parse(read('package.json'));assert.ok(!('lint' in pkg.scripts));assert.equal(pkg.scripts.compile,'node packages/compiler/src/compile.mjs');assert.ok(pkg.scripts.compile_fixture??pkg.scripts['compile:fixture']);
// The production cartridge (public/cartridge.{json,gcf}) is a legitimate generated
// artifact — compiled from the user's real archive and gitignored. Only demo/legacy
// sidecars are banned from shipping.
for(const stale of ['public/cartridge.index.json','public/demo-cartridge.json','public/demo-cartridge.gcf','public/demo-cartridge.index.json','public/enrichment.json','public/embeddings.jsonl','public/cpu-preview.html'])assert.equal(fs.existsSync(path.join(root,stale)),false,`stale/generated artifact ships in repo: ${stale}`);
if(fs.existsSync(path.join(root,'public/cartridge.json'))){assert.equal(fs.existsSync(path.join(root,'public/cartridge.gcf')),true,'production cartridge.json present without its .gcf twin');}
const sw=read('public/sw.js');assert.ok(sw.includes("cache:'no-store'"));assert.ok(sw.includes('networkFirst'));
const svg192=read('public/icon-192.svg'),svg512=read('public/icon-512.svg');assert.notEqual(svg192,svg512);assert.match(svg512,/viewBox="0 0 512 512"/);
const css=read('apps/room/src/styles.css');assert.ok(!css.includes('.hint{'));assert.ok(!css.includes('.revelation'));assert.ok(!css.includes('.inventory-item'));

// --- merge-plan checks (36-41): sidecars, sharded boot, truncation, echo honesty, parallel determinism ---
const sidecarDir=await fsPromises.mkdtemp(path.join(os.tmpdir(),'room-of-us-sidecar-'));
const fixtureOut=path.join(sidecarDir,'cartridge.json');
execFileSync(process.execPath,['packages/compiler/src/compile.mjs','data/demo/telegram.json',fixtureOut,'--role=Viktor=HIM','--role=Friend=HER','--shards=2'],{cwd:root,stdio:['ignore','pipe','inherit']});
execFileSync(process.execPath,['tools/verify-sidecar.mjs',path.join(sidecarDir,'cartridge')],{cwd:root}); // exits non-zero on any offset/hash failure
const core=JSON.parse(await fsPromises.readFile(path.join(sidecarDir,'cartridge-parts','core.json'),'utf8'));
assert.equal(core.integrity.sharded,true);
const shardTexts=[];for(const s of core.integrity.shards)shardTexts.push({file:s.file,text:await fsPromises.readFile(path.join(sidecarDir,'cartridge-parts',s.file),'utf8')});
const partsFetch=files=>async url=>{if(url==='/cartridge-parts/core.json')return {ok:true,status:200,json:async()=>core,text:async()=>JSON.stringify(core)};const f=files.find(x=>url.endsWith(x.file));if(!f)return {ok:false,status:404};return {ok:true,status:200,json:async()=>JSON.parse(f.text),text:async()=>f.text};};
const bootedSharded=await bootCartridge(partsFetch(shardTexts));await verifyCartridge(bootedSharded);assert.equal(bootedSharded.chat.message_count,c.chat.message_count);
const tamperedShards=shardTexts.map((s,i)=>i===0?{file:s.file,text:s.text.replace('Why','W hy')}:s);
await assert.rejects(()=>bootCartridge(partsFetch(tamperedShards)),/shard integrity failed|integrity/);
const rawFixText=await fsPromises.readFile(path.join(root,'data/demo/telegram.json'),'utf8');
const cutPath=path.join(sidecarDir,'truncated.json');await fsPromises.writeFile(cutPath,rawFixText.slice(0,Math.floor(rawFixText.length*0.7)));
execFileSync(process.execPath,['packages/compiler/src/compile.mjs',cutPath,path.join(sidecarDir,'trunc-cartridge.json'),'--role=Viktor=HIM','--role=Friend=HER'],{cwd:root,stdio:['ignore','pipe','inherit']});
const truncCartridge=JSON.parse(await fsPromises.readFile(path.join(sidecarDir,'trunc-cartridge.json'),'utf8'));
assert.equal(truncCartridge.chat.truncated,true);assert.ok(truncCartridge.chat.message_count>=1&&truncCartridge.chat.message_count<5,'truncation salvage count');
let strictThrew=false;try{execFileSync(process.execPath,['packages/compiler/src/compile.mjs',cutPath,path.join(sidecarDir,'strict-cartridge.json'),'--strict'],{cwd:root,stdio:'ignore'});}catch{strictThrew=true;}
assert.ok(strictThrew,'--strict must fail on truncated source');
const echoDir=await fsPromises.mkdtemp(path.join(os.tmpdir(),'room-of-us-echo-'));
const echoCart=path.join(echoDir,'cartridge.json');
execFileSync(process.execPath,['packages/compiler/src/compile.mjs','data/demo/telegram.json',echoCart,'--role=Viktor=HIM','--role=Friend=HER'],{cwd:root,stdio:['ignore','pipe','inherit']});
execFileSync(process.env.PYTHON||'python3',['tools/embed_cpu.py',echoCart],{cwd:root,env:{...process.env,EMBED_MOCK:'1'},stdio:['ignore','pipe','inherit']});
const echoCartridge=JSON.parse(await fsPromises.readFile(echoCart,'utf8'));
assert.equal(echoCartridge.tier0.discoveries.filter(d=>d.type==='echo').length,0,'mock backend must not fabricate echoes');
await verifyCartridge(echoCartridge);
const par=await compileTelegram(raw,{roles:{Viktor:'HIM',Friend:'HER'},parallelMin:0});
assert.equal(par.cartridge.integrity.content_manifest,c.integrity.content_manifest,'worker-parallel compile must be byte-identical');
assert.equal(par.cartridge.integrity.runtime_manifest,c.integrity.runtime_manifest,'worker-parallel runtime manifest mismatch');
await fsPromises.rm(sidecarDir,{recursive:true,force:true});await fsPromises.rm(echoDir,{recursive:true,force:true});
console.log('GAUNTLET: 41/41 BEHAVIORAL CHECKS PASSED');
