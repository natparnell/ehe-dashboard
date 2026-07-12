/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server on 3009 to avoid clashing with other WeST dashboards (3001/3007).
// Port 5060 is deliberately avoided (browsers block it as the SIP port).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3009,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/data/**', '**/public/processed/**', '**/public/geo/**'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
