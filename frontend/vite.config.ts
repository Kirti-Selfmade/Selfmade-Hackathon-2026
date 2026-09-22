import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the SPA proxies API + uploaded avatars to the ASP.NET Core backend,
// so the browser only ever talks to one origin (no CORS setup needed locally).
const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:5080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/uploads': { target: backend, changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  test: { environment: 'node' },
})
