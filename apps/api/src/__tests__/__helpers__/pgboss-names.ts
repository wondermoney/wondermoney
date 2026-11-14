/**
 * pg-boss's own name rules, for pg-boss test doubles.
 *
 * pg-boss refuses a queue name, dead-letter queue or schedule key that does not match
 * `/^[\w.\-/]+$/` (`attorney.assertObjectName`), at runtime, when the worker starts. A mocked boss
 * accepts anything, so a bad name used to pass every unit test and show up only as a worker that
 * never started. Wrap a double in `withPgBossNameRules` and it refuses what the real one refuses.
 */

/** What pg-boss accepts as a queue name or schedule key. */
export const PG_BOSS_NAME = /^[\w.\-/]+$/;

function assertName(value: unknown, what: string) {
  if (typeof value !== 'string' || !PG_BOSS_NAME.test(value)) {
    throw new Error(`pg-boss would reject ${what} ${JSON.stringify(value)}: only letters, digits, underscores, hyphens, periods and forward slashes are allowed`);
  }
}

const optionsOf = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

function assertQueue([name, options]: unknown[]) {
  assertName(name, 'queue name');
  const { deadLetter } = optionsOf(options);
  if (deadLetter) assertName(deadLetter, 'dead-letter queue');
}

const CHECKS: Record<string, (args: unknown[]) => void> = {
  createQueue: assertQueue,
  deleteQueue: ([name]) => {
    assertName(name, 'queue name');
  },
  schedule: ([name, , , options]) => {
    assertName(name, 'scheduled queue name');
    const { key } = optionsOf(options);
    if (key) assertName(key, 'schedule key');
  },
  updateQueue: assertQueue,
};

/**
 * The same double, refusing (with a rejected promise, as pg-boss does) to create, update, delete or
 * schedule a queue, or key a schedule, under a name pg-boss would not accept. Like pg-boss, it lets
 * `unschedule` through, so retired schedules with older names can still be removed.
 */
export function withPgBossNameRules<T extends object>(boss: T): T {
  return new Proxy(boss, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      const check = typeof property === 'string' ? CHECKS[property] : undefined;
      if (!check || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        try {
          check(args);
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return (value as (...callArgs: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
