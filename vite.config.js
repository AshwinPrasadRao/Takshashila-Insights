import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/Takshashila-Insights/', // GitHub Pages base path
  plugins: [react()],
  build: { outDir: 'docs' },
})
