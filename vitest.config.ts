import { defineConfig } from 'vitest/config';

// Vitest runs only the Devvit harness tests (*.devvit.test.ts). The pure-logic
// suite runs separately under node:test (npm run test:unit).
export default defineConfig({
  test: {
    include: ['src/**/*.devvit.test.ts'],
  },
});
