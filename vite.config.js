import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dataApi from './server/data-api.js';

export default defineConfig({
  plugins: [react(), dataApi({ dir: 'data' })],
  server: { port: 5173, watch: { ignored: ['**/data/**'] } },
  build: { chunkSizeWarningLimit: 4000 },
});
