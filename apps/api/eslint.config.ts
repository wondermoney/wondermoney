import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { default as prettier } from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import * as regexp from 'eslint-plugin-regexp';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * The only test files allowed to touch the filesystem, and why.
 *
 * Keep this list short and justified. "I need to assert on the text of a source/migration/config
 * file" is never a reason to be added here — that is the exact pattern the rule exists to stop.
 * The two grandfathered schema-lock entries below should shrink, not grow.
 */
const FS_IN_TESTS_ALLOWLIST = [
  // Reads .env.sample to assert it documents every variable the schema requires. Validation
  // is unconditional now, so an undocumented required key means a new developer copies the
  // sample, boots, and the container refuses to start. The file *is* the fixture here.
  'src/config/__tests__/env.test.ts',
  // Real PDF fixtures for the IGCP certificado-aforro rate-table parser.
  'src/jobs/__tests__/certificado-aforro-rate-table.test.ts',
  // Writes to a temp dir to exercise a script whose job is producing a CSV file on disk
  // (including the PII-redaction assertion on the emitted file).
  'src/database/scripts/__tests__/export-growth-recovery-segments.test.ts',
  // Binary fixture for the attribution-envelope wire format.
  'src/services/__tests__/attribution-envelope.service.test.ts',
  // Grandfathered: reads app.ts to assert the authed-mount middleware chain
  // (requireAuth → getUser → resolveTenantForRequest → assertTenantResolved → blockDemoMutation).
  // The invariant is load-bearing; the mechanism is not. Replace with a mounted-app test.
  'src/routes/v1/__tests__/demo-guard-route-coverage.test.ts',
  // Grandfathered: reads the MikroORM snapshot as a schema lock over growth/trial tables.
  'src/services/__tests__/growth-data-model.test.ts',
  'src/services/__tests__/trial-lifecycle.service.test.ts',
  // The migration script reads/writes from a tempdir to test the file-import dry-run path.
];

export default defineConfig(
  globalIgnores(
    [
      '**/*.snap',
      'coverage',
      'lib',
      'node_modules',
      '.claude',
      '.claude/**',
      '.opencode',
      '.opencode/**',
      '.serena',
      '.serena/**',
      '.slim',
      '.slim/**',
      '.worktrees',
      '.worktrees/**',
      'yarn.lock',
      'dist',
      'scripts',
      'src/database/utils/raw-files',
      'src/database/utils/raw-files/**',
      'src/database/utils/splitted-files',
      'src/database/utils/splitted-files/**',
      'temp',
      'temp/**',
      '**/*.d.ts',
      '**/migrations/**',
      '**/seeders/**',
    ],
    'Global Ignores',
  ),
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    extends: [
      comments.recommended,
      eslint.configs.recommended,
      perfectionist.configs['recommended-natural'],
      regexp.configs['flat/recommended'],
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      prettier,
    ],
    files: ['**/*.{js,ts}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.ts', 'vitest.config.ts', 'vitest.setup.ts'],
          defaultProject: './tsconfig.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // These on-by-default rules work well for this repo if configured
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: true }],
      /* '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowBoolean: true, allowNullish: true, allowNumber: true },
      ], */
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/no-invalid-void-type': 'off',
      // Stays a warning: the bulk of these are `arr[i]!` and `map.get(k)!`, where the assertion
      // restates something the surrounding code has already established. Erroring on those would
      // fail CI on ~190 sites that carry no risk.
      //
      // The instances that *did* matter were `req.user!` / `req.tenant!`, which asserted to the
      // compiler and checked nothing at runtime: a route mounted without `getUser` or
      // `resolveTenantForRequest` carried on with `undefined` — the exact shape of the
      // `/v1/operations` mount that had lost its tenant middleware. Those 71 now go through
      // `authedContext` / `authedUser`, and the `no-restricted-syntax` rule below is what keeps
      // them from coming back, rather than a blanket rule nobody could act on.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'off',
      // The narrow version of the above, as an error because it is precise enough to obey.
      'no-restricted-syntax': [
        'error',
        {
          message: 'Use authedContext(req) or authedUser(req) from @middleware/authed-context. `req.user!` asserts to the compiler and checks nothing at runtime, so a route mounted without getUser/resolveTenantForRequest proceeds with undefined instead of failing.',
          selector: 'TSNonNullExpression > MemberExpression[object.name="req"][property.name=/^(user|tenant)$/]',
        },
        {
          message: '`as never` is forbidden — it is assignable to every type and erases the compiler\'s ability to flag a genuine mismatch. Retype the value (FilterQuery<T>, FindOptions<T>, RequiredEntityData<T>, EntityKey<T>) or use the typed test helpers in src/__tests__/__helpers__/. New uses are caught here; existing usages are tracked in the arch/as-never-batch refactor.',
          selector: 'TSAsExpression[typeAnnotation.typeName.name="never"], TSAsExpression[typeAnnotation.type="TSNeverKeyword"]',
        },
      ],

      // Stylistic concerns that don't interfere with Prettier
      'logical-assignment-operators': ['error', 'always', { enforceForIfStatements: true }],
      'no-useless-rename': 'error',
      'object-shorthand': 'error',
      'operator-assignment': 'error',

      // https://github.com/eslint-community/eslint-plugin-n/issues/472
      'n/no-unpublished-bin': 'off',

      // Import ordering: sentry first, then external packages, then internal (path aliases)
      'perfectionist/sort-imports': [
        'error',
        {
          customGroups: [
            {
              elementNamePattern: '@service/sentry',
              groupName: 'side-effect-sentry',
            },
          ],
          groups: [
            'side-effect-sentry',
            'side-effect',
            ['value-builtin', 'type-builtin'],
            ['value-external', 'type-external'],
            ['value-internal', 'type-internal'],
            ['value-parent', 'type-parent'],
            ['value-sibling', 'type-sibling'],
            ['value-index', 'type-index'],
            'unknown',
          ],
          internalPattern: ['^@(entity|controller|route|service|utils|validators|middleware|config|app)/.*'],
          type: 'natural',
        },
      ],
    },
    settings: { perfectionist: { partitionByComment: true, type: 'natural' } },
  },
  {
    extends: [vitest.configs.recommended],
    files: ['**/*.test.*'],
    rules: {
      // Downgraded in tests only. A `!` on a fixture or a mock call record asserts something the
      // test itself controls — if it is wrong the test fails, which is the point. Enforcing it
      // here buried the production instances that actually mattered under ~190 harmless ones.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // A test that reads source, migration, config or package.json text off disk and asserts on
      // it is coupled to formatting, import style and file paths rather than to behaviour: it
      // fails on a rename and passes on a regression. If an invariant matters, encode it in a
      // type or a lint rule, not a `readFileSync` + `toContain`. See CLAUDE.md → Important Rules.
      //
      // Genuine fixture loading is still fine — add the file to FS_IN_TESTS_ALLOWLIST below with
      // a reason rather than disabling the rule inline.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              message:
                'Tests must not read files off disk. Assert behaviour, not file text. Genuine fixture loading: add the file to FS_IN_TESTS_ALLOWLIST in eslint.config.ts.',
              name: 'fs',
            },
            {
              message:
                'Tests must not read files off disk. Assert behaviour, not file text. Genuine fixture loading: add the file to FS_IN_TESTS_ALLOWLIST in eslint.config.ts.',
              name: 'node:fs',
            },
            {
              message:
                'Tests must not read files off disk. Assert behaviour, not file text. Genuine fixture loading: add the file to FS_IN_TESTS_ALLOWLIST in eslint.config.ts.',
              name: 'fs/promises',
            },
            {
              message:
                'Tests must not read files off disk. Assert behaviour, not file text. Genuine fixture loading: add the file to FS_IN_TESTS_ALLOWLIST in eslint.config.ts.',
              name: 'node:fs/promises',
            },
          ],
        },
      ],
    },
    settings: { vitest: { typecheck: true } },
  },
  {
    files: FS_IN_TESTS_ALLOWLIST,
    rules: { 'no-restricted-imports': 'off' },
  },
  //{ extends: [packageJson.configs.recommended], files: ['package.json'] },
);
