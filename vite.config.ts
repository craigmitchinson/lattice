import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fully client-side tool: everything bundles locally, no CDN resources,
// no runtime network access. The build output must be servable from a
// static folder or file share with no external dependencies.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
