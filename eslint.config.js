// The boundary lint: what may import what between the core and the modules, how long a file may
// grow, and the house rules a typecheck can't see.
import { existsSync, readFileSync } from 'node:fs';
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
const sources = [
  'contract/src',
  'service/src',
  'app/src',
  'ui/src',
  'modules',
  'extra-modules',
  'scripts',
];
const ui = ['ui/src', 'modules/*/ui'];
// What the specs of a part share, in its *-testing.ts, is test code too.
const tests = sources.flatMap((root) => [
  `${root}/**/*.spec.ts`,
  `${root}/**/*.test.ts`,
  `${root}/**/*-testing.ts`,
]);

// What a module may import from the service: its exports map, testing/* in tests only. The
// paths match under any folder, since the private repo lints its modules with the core in core/.
const exported = Object.entries(
  JSON.parse(readFileSync(new URL('service/package.json', import.meta.url), 'utf8')).exports,
).map(([name, file]) => ({ name, path: path.posix.join('**', 'service', file) }));
const forTests = ({ name }) => name.startsWith('./testing/');
const surface = exported.filter((entry) => !forTests(entry)).map((entry) => entry.path);
const testing = exported.filter(forTests).map((entry) => entry.path);

// The one file in each part of the core that may import the modules.
const registrations = [
  'service/src/modules.ts',
  'ui/src/app/app.config.ts',
  'contract/src/index.ts',
];

const maxLines = { max: 400, skipBlankLines: true, skipComments: true };
const maxTestLines = { ...maxLines, max: 600 };

const code = [
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
];

/** Whether a statement exports code that runs: a function or a class, not only types or values. */
const exportsCode = (statement) => {
  const declared =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? statement.declaration
      : undefined;
  const runs = (node) => code.includes(node?.type);
  if (declared?.type === 'VariableDeclaration')
    return declared.declarations.some((declaration) => runs(declaration.init));
  return runs(declared);
};

// Each file of code has its own test beside it, so code moved to a new file takes its tests along.
const ownTest = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missing: 'No test of its own: add {{name}}.test.ts or {{name}}.spec.ts beside it.',
    },
  },
  create: (context) => ({
    Program(program) {
      if (!program.body.some(exportsCode)) return;
      const base = context.physicalFilename.replace(/\.ts$/, '');
      if (existsSync(`${base}.test.ts`) || existsSync(`${base}.spec.ts`)) return;
      context.report({
        loc: { line: 1, column: 0 },
        messageId: 'missing',
        data: { name: path.basename(base) },
      });
    },
  }),
};
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
  { ignores: ['**/dist/**', 'ui/vendor/**'] },
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
  {
    files: sources.map((root) => `${root}/**/*.ts`),
    ignores: [...tests, '**/*.d.ts'],
    plugins: { house: { rules: { 'own-test': ownTest } } },
    rules: { 'house/own-test': 'error' },
  },
  {
    files: tests,
    rules: {
      'no-restricted-syntax': ['error', ...realClock],
      'max-lines': ['error', maxTestLines],
    },
  },
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
        { type: 'extra-modules', pattern: 'extra-modules' },
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
              message: 'A module imports no other module: use its commands and events.',
            },
            {
              from: { element: { types: ['contract', 'service-core', 'ui-core'] } },
              disallow: { to: { element: { types: ['module', 'extra-modules'] } } },
              message: `The core imports a module only from ${registrations.join(', ')}.`,
            },
            {
              from: { file: { path: registrations } },
              allow: { to: { element: { types: ['module', 'extra-modules'] } } },
            },
            {
              from: { element: { type: 'module' } },
              disallow: { to: { element: { type: 'service-core' } } },
              message:
                'A module imports the service only through @grimoire/service/core/* and claude/*, not {{ to.file.path }}.',
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
