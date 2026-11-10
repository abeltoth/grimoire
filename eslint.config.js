// The boundary lint: what may import what between the core and the modules, how long a file may
// grow, and the house rules a typecheck can't see.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import boundaries from 'eslint-plugin-boundaries';

// The type-aware rules need a program per file, and modules/* has no tsconfig of its own.
const projects = [
  'contract/tsconfig.json',
  'service/tsconfig.json',
  'app/tsconfig.json',
  'ui/tsconfig.app.json',
  'ui/tsconfig.spec.json',
];
const sources = ['contract/src', 'service/src', 'app/src', 'ui/src', 'modules', 'scripts'];
const ui = ['ui/src', 'modules/*/ui'];
// What the specs of a part share, in its *-testing.ts, is test code too.
const tests = sources.flatMap((root) => [
  `${root}/**/*.spec.ts`,
  `${root}/**/*.test.ts`,
  `${root}/**/*-testing.ts`,
]);

// What a module may import from the service: its exports map (ADR-012), testing/* in tests only.
const exported = Object.entries(
  JSON.parse(readFileSync(new URL('service/package.json', import.meta.url), 'utf8')).exports,
).map(([name, file]) => ({ name, path: path.posix.join('service', file) }));
const forTests = ({ name }) => name.startsWith('./testing/');
const surface = exported.filter((entry) => !forTests(entry)).map((entry) => entry.path);
const testing = exported.filter(forTests).map((entry) => entry.path);

// The one file in each part of the core that may import the modules.
const registrations = [
  'service/src/modules.ts',
  'ui/src/app/app.config.ts',
  'contract/src/index.ts',
];

// Tests still on the real clock, only warned about until they're fixed (REFACTOR.md 4.2).
const onTheRealClock = [
  'app/src/service-launcher.test.ts',
  'modules/chat/ui/composer.spec.ts',
  'modules/chat/ui/settings-card.spec.ts',
  'modules/chat/ui/transcript.spec.ts',
  'modules/files/service/files.test.ts',
  'modules/git/ui/git.spec.ts',
  'modules/kanban/ui/kanban-testing.ts',
  'modules/memories/ui/memories-page.spec.ts',
  'modules/memories/ui/memory-editor.spec.ts',
  'modules/memories/ui/memory-list.spec.ts',
  'modules/schedules/ui/schedules.spec.ts',
  'modules/settings/ui/general-settings.spec.ts',
  'modules/terminal/service/terminals.test.ts',
  'modules/usage/service/usage.test.ts',
  'modules/workflow-setup/service/setup-files.test.ts',
  'modules/workflow-setup/ui/workflow-setup.spec.ts',
];

const maxLines = { max: 400, skipBlankLines: true, skipComments: true };
const clockMessage =
  'Tests never read the real clock: use vi.setSystemTime() or pass in a fixed now.';
const realClock = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: clockMessage,
  },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: clockMessage },
];

export default defineConfig(
  { ignores: ['**/dist/**', 'ui/vendor/**', 'design/**'] },
  {
    files: sources.map((root) => `${root}/**/*.ts`),
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { project: projects, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A leading underscore marks a value left unused on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ui.map((root) => `${root}/**/*.ts`),
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
  },
  {
    files: ui.map((root) => `${root}/**/*.html`),
    extends: [angular.configs.templateRecommended],
  },
  // Stylesheets get the same limit from the style guard, since ESLint doesn't parse CSS here.
  {
    files: sources.flatMap((root) => [`${root}/**/*.ts`, `${root}/**/*.html`, `${root}/**/*.mjs`]),
    ignores: tests,
    rules: { 'max-lines': ['error', maxLines] },
  },
  { files: tests, rules: { 'no-restricted-syntax': ['error', ...realClock] } },
  { files: onTheRealClock, rules: { 'no-restricted-syntax': ['warn', ...realClock] } },
  {
    files: sources.map((root) => `${root}/**/*.ts`),
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: projects, noWarnOnMultipleProjects: true } },
      'boundaries/elements': [
        { type: 'contract', pattern: 'contract/src' },
        { type: 'service-core', pattern: 'service/src' },
        { type: 'ui-core', pattern: 'ui/src' },
        { type: 'module', pattern: 'modules/*', capture: ['name'] },
      ],
    },
    rules: {
      // Later policies win over earlier ones.
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'module' } },
              disallow: {
                to: {
                  element: {
                    type: 'module',
                    captured: { name: '!{{ from.element.captured.name }}' },
                  },
                },
              },
              message: 'A module imports no other module (ADR-008): use its commands and events.',
            },
            {
              from: { element: { types: ['contract', 'service-core', 'ui-core'] } },
              disallow: { to: { element: { type: 'module' } } },
              message: `The core imports a module only from ${registrations.join(', ')}.`,
            },
            {
              from: { file: { path: registrations } },
              allow: { to: { element: { type: 'module' } } },
            },
            {
              from: { element: { type: 'module' } },
              disallow: { to: { element: { type: 'service-core' } } },
              message:
                'A module imports the service only through @grimoire/service/core/* and claude/* (ADR-012), not {{ to.file.path }}.',
            },
            {
              from: { element: { type: 'module' } },
              allow: { to: { element: { type: 'service-core' }, file: { path: surface } } },
            },
            {
              from: { element: { type: 'module' }, file: { path: tests } },
              allow: { to: { element: { type: 'service-core' }, file: { path: testing } } },
            },
          ],
        },
      ],
    },
  },
);
