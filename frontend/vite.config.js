import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El front llama a /api/... y Vite lo reenvía al backend (evita CORS en desarrollo).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' } },
});
