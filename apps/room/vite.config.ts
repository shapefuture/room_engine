import {defineConfig} from 'vite';
import {fileURLToPath, URL} from 'node:url';

const root=fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  server:{port:5173},
  build:{outDir:fileURLToPath(new URL('../../dist', import.meta.url)),emptyOutDir:true}
});
