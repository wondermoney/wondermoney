import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@controller': path.resolve(__dirname, 'src/controller'),
      '@entity': path.resolve(__dirname, 'src/database/entity'),
      '@middleware': path.resolve(__dirname, 'src/middleware'),
      '@route': path.resolve(__dirname, 'src/routes/v1'),
      '@service': path.resolve(__dirname, 'src/services'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@validators': path.resolve(__dirname, 'src/validators'),
    },
  },
  test: {
    coverage: {
      exclude: [
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/*.d.ts',
        '**/migrations/**',
        '**/seeds/**',
        '**/mikro-orm.config.ts',
        '**/app.ts',
        '**/server.ts',
        'src/test/**',
      ],
      // `src/jobs`, `src/middleware`, `src/config` and `src/routes` were absent for a long
      // time, which meant the worker — where most of the scheduling, claiming and email-send
      // logic lives — reported no coverage at all. They were not untested; they were
      // uncounted. Adding them moved the headline number by less than half a point, because
      // they are covered about as well as the directories that were already here.
      //
      // `src/routes/v1` reads oddly and honestly: ~96% statements against ~14% functions,
      // because a route file is mostly `router.get(...)` declarations that execute on import
      // while the handlers behind them are never invoked through the router. That gap is worth
      // seeing rather than hiding.
      include: [
        'src/config/**/*.ts',
        'src/controller/**/*.ts',
        'src/database/repositories/**/*.ts',
        'src/jobs/**/*.ts',
        'src/middleware/**/*.ts',
        'src/routes/**/*.ts',
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      // Ratcheted to roughly three points below the measured numbers, which leaves room for an
      // ordinary change to dip without failing CI while still catching a real regression. The
      // previous values (63/67/66/66) were set before `src/jobs`, `src/middleware`, `src/config`
      // and `src/routes` were instrumented and sat 8-15 points below reality, so the gate could
      // not have caught anything. Raise these again when the numbers move, not before.
      //
      // Long-term target from CLAUDE.md remains 80% statements / 75% branches.
      thresholds: {
        branches: 68,
        functions: 75,
        lines: 77,
        statements: 75,
      },
    },
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
