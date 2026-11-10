# API CLIENT KNOWLEDGE BASE

## OVERVIEW

Domain-organized HTTP and React Query boundary. Functions encode API contracts; hooks encode caching, query keys, mutation side effects, and consumer state.

## STRUCTURE

```text
api.ts, api-server.ts  # Browser/server HTTP clients
errors.ts, rate-limit* # Shared error normalization and 429 handling
{domain}/use*.ts       # Query/mutation functions and hooks
{domain}/types.ts      # Request/response contracts
**/__tests__/          # Vitest coverage for selected hooks/helpers
```

## CONVENTIONS

- Export a plain request function and a `useX` hook. Accept an injectable client where tests/server use require it.
- Query keys are domain-first arrays (`["account", accountId]`) and include every input that changes the result. Reuse the key the domain's existing hooks use.
- Mutations invalidate or update the narrow affected keys after success; preserve rollback/error behavior where optimistic state exists.
- Use React Query for remote state; do not mirror query results into Zustand or component-local caches.
- Normalize API errors through the shared client/error helpers so forced-logout and retry policy remain centralized.
- Keep browser and server clients separate. Never leak server credentials, cookies, or request-only objects to client modules.
- Contract changes must be checked against the `apps/api` handlers/validators and all consuming hooks/components.

## ANTI-PATTERNS

- Never build query keys in feature components; they belong to the hook.
- Never invalidate the entire cache when a domain key is sufficient.
- Never force logout or suppress all retries from one hook; auth policy is centralized.
- Never swallow an API error into `undefined` when loading/empty/error states differ.

## VERIFICATION

```bash
pnpm type-check
pnpm lint
pnpm test
```

`pnpm test` runs the whole suite, the import/background-operation hook tests included. Inspect key invalidation at each mutation call site.
