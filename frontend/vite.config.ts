import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // три страницы: цифровой двойник, лёгкий пульт HMI для панелей у линии и админка
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        hmi: fileURLToPath(new URL('./hmi.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.ALLUR_API_TARGET || process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000', ws: true } },
  },
})
