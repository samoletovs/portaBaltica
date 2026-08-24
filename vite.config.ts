import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Only React is chunked by hand. Everything else is left to the
        // natural boundaries created by the lazy route imports in main.tsx.
        //
        // There used to be a `charts` rule here that pulled recharts and d3
        // into their own chunk. It backfired: React is a dependency of
        // recharts, so React was assigned to the chart chunk, which made that
        // 418 kB bundle a static dependency of the entry chunk and therefore
        // of *every* route. The news feed was downloading the whole charting
        // library in order to get `useState`. Splitting React out instead lets
        // recharts fall into the lazily-loaded chunks that actually use it.
        //
        // Measured with `node scripts/route-weight.mjs` after a build:
        //   with the charts rule    /  = 654 kB    /data = 716 kB
        //   with this rule          /  = 255 kB    /data = 717 kB
        //
        // Re-run that script before changing anything here.
        manualChunks(id: string) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
        },
      },
    },
  },
})
