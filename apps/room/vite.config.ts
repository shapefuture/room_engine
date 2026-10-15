import {defineConfig} from 'vite';
import {fileURLToPath, URL} from 'node:url';

const root=fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  publicDir:fileURLToPath(new URL('../../public', import.meta.url)),
  server:{port:5173},
  build:{outDir:fileURLToPath(new URL('../../dist', import.meta.url)),emptyOutDir:true}
});
