import { defineConfig } from 'vitest/config';

// Node tests: contract, service, app, and the UI's style guard. The UI's
// component tests run through the Angular CLI (`npm test -w @grimoire/ui`).
export default defineConfig({
  test: {
    include: [
      'contract/src/**/*.test.ts',
      'service/src/**/*.test.ts',
      'app/src/**/*.test.ts',
      'ui/tools/**/*.test.ts',
    ],
    environment: 'node',
  },
});
