import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The performance test ingests a synthetic 150-file estate; allow
    // headroom beyond the default 5 s per test.
    testTimeout: 60_000,
  },
});
