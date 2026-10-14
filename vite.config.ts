import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// `import.meta.dirname` replaces `__dirname` (which Vite's native config loader
// warns about and will stop supporting).
const projectRoot = import.meta.dirname ?? process.cwd();

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, '.'),
      },
    },
    build: {
      // The app's own code is ~250 kB; the only larger chunk is hls.js, a single
      // third-party library that is loaded lazily the first time a player opens.
      // The threshold is raised just past it so build output stays warning-free
      // without masking any real problem.
      chunkSizeWarningLimit: 700,
      // Split large third-party libraries out of the main bundle so the app
      // shell stays small and cacheable.
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'vendor-hls', test: /node_modules[\\/]hls\.js[\\/]/ },
              { name: 'vendor-motion', test: /node_modules[\\/](motion|framer-motion)[\\/]/ },
              { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            ],
          },
        },
      },
    },
    server: {
      // اجازه دسترسی با هر Host (IP عمومی/دامنه) — بدون این، دسترسی از بیرون شبکه
      // یا با VPN به‌دلیل بررسی Host به‌صورت 403 رد می‌شد.
      allowedHosts: true as const,
      // HMR can be disabled via DISABLE_HMR when file watching is undesirable.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
