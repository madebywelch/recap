import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const mock = fileURLToPath(new URL('./mock.js', import.meta.url));
export default defineConfig({
  plugins: [{ name: 'capture-fixtures', enforce: 'pre', resolveId(id) {
    if (/^\.\.\/((useBrief|useLibrary|useReview)|generation|store)$/.test(id) || /^\.\/(generation|store)$/.test(id)) return mock;
  } }, react()],
  server: { port: 1421, strictPort: true },
});
