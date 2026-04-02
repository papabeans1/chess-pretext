import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/chess-pretext/',
  build: {
    target: 'esnext',
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
