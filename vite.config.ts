import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Capacitor (P9) serves the built bundle from the filesystem, so relative asset
// paths are required from the start — absolute /assets/ URLs break on Android.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
