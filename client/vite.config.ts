import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'DIGIMINE – Mining Site Operations',
        short_name: 'DIGIMINE',
        description: 'Field entry and operations management for mining sites',
        theme_color: '#1c1917',
        background_color: '#fafaf9',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//] },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
})
