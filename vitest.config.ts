import { defineConfig } from 'vitest/config';

// Node tests: contract, service, the modules' backends, app, the UI's style guard, and the Claude
// Code and git hooks. The UI's component tests run through the Angular CLI
// (`npm test -w @grimoire/ui`).
export default defineConfig({
  test: {
    include: [
      'contract/src/**/*.test.ts',
      'service/src/**/*.test.ts',
      'modules/*/service/**/*.test.ts',
      'extra-modules/*.test.ts',
      'app/src/**/*.test.ts',
      'ui/tools/**/*.test.ts',
      '.claude/hooks/*.test.ts',
      '.githooks/*.test.ts',
    ],
    environment: 'node',
  },
});
