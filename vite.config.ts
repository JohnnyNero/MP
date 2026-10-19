import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // index.html sends players to the 3D arenas (public/arenas); legacy.html is the parked 2D board game (src/)
  build: { chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: 'index.html', legacy: 'legacy.html' } } },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.js'] },
});
