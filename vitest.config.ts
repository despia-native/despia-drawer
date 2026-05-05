import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts']
  }
});
