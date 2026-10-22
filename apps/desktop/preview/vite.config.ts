import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5199, proxy: { '/v1': { target: 'http://localhost:18090', ws: true }, '/health': 'http://localhost:18090' } },
});
