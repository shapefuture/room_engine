import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const config=fs.readFileSync(path.join(root,'apps/room/vite.config.ts'),'utf8');
if(!config.includes("fileURLToPath(new URL('.', import.meta.url))"))throw new Error('Vite root is not path-safe');
if(!fs.existsSync(path.join(root,'apps/room/index.html')))throw new Error('frontend entry missing');
if(!fs.existsSync(path.join(root,'apps/room/src/main.ts')))throw new Error('frontend source missing');
if(!fs.existsSync(path.join(root,'node_modules','vite'))){console.error('BUILD PREFLIGHT: source/config PASS; Vite dependency absent, so production bundle is unverified.');process.exit(3);}
console.log('BUILD PREFLIGHT: PASS');
