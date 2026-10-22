import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run web`: the desktop UI in a normal browser at http://localhost:5300 (see main.ts).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5300, strictPort: true },
});
