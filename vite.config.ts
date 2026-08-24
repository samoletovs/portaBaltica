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
        // Measured with `node scripts/route-weight.mjs`, both arms in one build:
        //   with the charts rule    /  = 654 kB    /data = 716 kB
        //   with this rule          /  = 255 kB    /data = 717 kB
        //
        // The /data figure tracks the dashboard and drifts as tiles are added —
        // it is 727 kB since the PowerMarketCard chart arrived in #18. The pair
        // above is what matters: ~400 kB the news routes stopped paying, which
        // has not moved.
        //
        // Re-run that script before changing anything here.
        manualChunks(id: string) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
        },
      },
    },
  },
})
