// Rebuilds public/cartridge-parts/ (or the dir beside any cartridge) from the
// monolith. Runs after enrichment/reseal (embed_cpu.py) so the sharded boot
// artifact always matches the cartridge's current integrity manifests.
// Usage: node tools/rebuild-shards.mjs [cartridge.json] [rowsPerShard]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildShards} from '../packages/shared/src/runtime-core.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const cartridgePath=path.resolve(root,process.argv[2]??'public/cartridge.json');
const rowsPerShard=Number(process.argv[3]??4096);
const cartridge=JSON.parse(fs.readFileSync(cartridgePath,'utf8'));
const {core,shards}=await buildShards(cartridge,rowsPerShard);
const partsDir=path.join(path.dirname(cartridgePath),'cartridge-parts');
fs.rmSync(partsDir,{recursive:true,force:true});fs.mkdirSync(partsDir,{recursive:true});
fs.writeFileSync(path.join(partsDir,'core.json'),JSON.stringify(core,null,2));
for(const f of shards)fs.writeFileSync(path.join(partsDir,f.file),f.text);
console.log(`Rebuilt ${shards.length} shards -> ${partsDir} (rowsPerShard=${rowsPerShard})`);
