import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['evals/**/*.eval.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 60_000,
  },
});
