/**
 * Child-process half of `pg-test-db.ts`: discover every entity with ts-morph and write
 * MikroORM's per-entity metadata cache into the directory given as the only argument.
 *
 * It runs outside vitest on purpose. ts-morph locates each entity's source from the
 * decorator call site, and under vitest's transform that call site is the injected
 * decorator helper rather than the entity file, so discovery inside the test process
 * cannot find the types. The harness reads this cache back instead.
 *
 * Nothing connects to a database here: MikroORM connects lazily and nothing is queried.
 */
import { MikroORM } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';

const cacheDir = process.argv[2];
if (!cacheDir) throw new Error('usage: generate-entity-metadata.ts <cacheDir>');

const orm = await MikroORM.init({
  dbName: 'metadata-only',
  entities: ['./dist/database/entity/*.js'],
  entitiesTs: ['./src/database/entity/*.ts'],
  metadataCache: { enabled: true, options: { cacheDir } },
  metadataProvider: TsMorphMetadataProvider,
  preferTs: true,
});
await orm.close();
