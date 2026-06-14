import { defineConfig, loadEnv } from 'vite';
import type { PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

function manualVendorChunks(id: string) {
  if (!id.includes('node_modules')) return undefined;

  const normalized = id.replace(/\\/g, '/');
  const match = normalized.match(
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/
  );
  const pkg = match?.[1];

  if (!pkg) return undefined;
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react';
  if (pkg.startsWith('@tanstack/')) return 'vendor-query';

  if (
    pkg === 'framer-motion' ||
    pkg === 'motion' ||
    pkg === 'motion-dom' ||
    pkg === 'motion-utils' ||
    pkg === 'motion-react'
  ) {
    return 'vendor-motion';
  }

  if (pkg === 'zustand' || pkg === 'sonner') return 'vendor-ui';
  if (pkg === 'lucide-react') return 'vendor-icons';
  if (pkg.startsWith('@sentry/')) return 'vendor-monitoring';

  return undefined;
}

const isAnalyze = process.env.npm_lifecycle_event === 'build:analyze' || process.env.ANALYZE === '1';

function normalizeCanonicalURL(value?: string) {
  const raw = value?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function canonicalURLPlugin(canonicalURL?: string): PluginOption {
  return {
    name: 'hloolmail-canonical-url',
    transformIndexHtml: canonicalURL
      ? {
          order: 'pre',
          handler: () => [
            {
              tag: 'link',
              attrs: { rel: 'canonical', href: canonicalURL },
              injectTo: 'head'
            }
          ]
        }
      : undefined
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const canonicalURL = normalizeCanonicalURL(env.VITE_CANONICAL_URL);

  return {
    plugins: [
      react(),
      tailwindcss(),
      canonicalURLPlugin(canonicalURL),
      ...(isAnalyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              sourcemap: false
            })
          ]
        : [])
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3000'
      }
    },
    build: {
      chunkSizeWarningLimit: 500,
      target: 'es2020',
      cssCodeSplit: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: manualVendorChunks,
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]'
        }
      }
    }
  };
});
