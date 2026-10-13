/**
 * Minimal ambient types for `js-yaml` (used by capture-screens.ts).
 *
 * The docs-new repo has no `@types/js-yaml` dependency and adding one is out of
 * scope ("no new deps" for the RAD-427 capture pipeline). Only the `load`
 * function is used, so only that is declared here. The project tsconfig's
 * `include` covers `.d.ts` files, so this keeps `yarn type-check` green.
 */
declare module 'js-yaml' {
  export function load(
    input: string,
    options?: { schema?: unknown; json?: boolean; filename?: string },
  ): unknown;
}
