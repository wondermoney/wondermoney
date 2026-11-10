# DATABASE KNOWLEDGE BASE

## OVERVIEW

MikroORM persistence boundary: entities, custom repositories, schema-only migrations, seeders, and the few reusable scripts in `scripts/`. Migration and `.env` safety rules are in `../../CLAUDE.md`.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Entity model | `entity/` | Decorated classes extend `Base` |
| Query behavior | `repositories/` | Preserve tenant and soft-delete filters |
| Schema evolution | `migrations/` | DDL only; one baseline, then new migrations |
| Reference/bootstrap data | `seeders/` | All data insertion belongs here |
| Runtime connection | `di.ts`, `../mikro-orm.config.ts` | `DI.em` and request contexts |
| Demo/test operations | `../services/demo-data/`, `scripts/` | Operational code, not migrations |

## CONVENTIONS

- Entities are PascalCase classes extending `Base`; primary keys use `entityNameKey`. Declare relation columns and database details explicitly in decorators.
- Most user-owned records carry `tenantKey`; preserve tenant isolation in entities, repositories, and unique constraints.
- Soft deletion uses `deletedAt`; queries must not silently reintroduce deleted rows.
- Custom repositories hold reusable persistence queries. Keep orchestration/business policy in the calling service.
- Migration files describe schema changes only. Put inserts, updates, deletes, and bootstrap records in seeders.
- Tests remain close to repositories/services and use the same MikroORM shapes rather than weakening types.

## ANTI-PATTERNS

- Never put DML or production backfills in a migration.
- Never run `migrate:dev:fresh` against staging, production, or any non-disposable database.
- Never remove decorator metadata or change key/column naming incidentally.
- Never break demo running-balance date ordering.

## VERIFICATION

```bash
pnpm type-check
pnpm test src/database
pnpm migrate:dev:check
pnpm migrate:dev:fresh   # Only after confirming a disposable local/test target
```
