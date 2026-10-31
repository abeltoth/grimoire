import { defineConfig } from 'vitest/config';

// Backend tests: contract, service and app. The UI runs its own tests
// through the Angular CLI (`npm test -w @grimoire/ui`).
export default defineConfig({
  test: {
    include: ['contract/src/**/*.test.ts', 'service/src/**/*.test.ts', 'app/src/**/*.test.ts'],
    environment: 'node',
  },
});
