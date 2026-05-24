import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function manualVendorChunks(id: string) {
  if (!id.includes('node_modules')) return undefined;

  const normalized = id.replace(/\\/g, '/');
  const match = normalized.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
  const pkg = match?.[1];

  if (!pkg) return undefined;
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react';
  if (pkg.startsWith('@tanstack/')) return 'vendor-query';
  if (pkg === 'framer-motion' || pkg === 'motion-dom' || pkg === 'motion-utils') return 'vendor-motion';
  if (pkg === 'zustand' || pkg === 'sonner') return 'vendor-ui';

  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: manualVendorChunks
      }
    }
  }
});
