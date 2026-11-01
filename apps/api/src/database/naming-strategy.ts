import { createHash } from 'node:crypto';

import { UnderscoreNamingStrategy } from '@mikro-orm/core';

type IndexType = Parameters<UnderscoreNamingStrategy['indexName']>[2];

/** Postgres truncates identifiers longer than this. */
const MAX_IDENTIFIER_LENGTH = 63;

/**
 * MikroORM's naming, with long constraint and index names shortened the way the existing schema
 * has them: the name cut to fit, then the first five hex digits of its MD5 and the type
 * (`..._a7290_foreign`). MikroORM 7 hashes with FNV-1a instead, so without this every such name
 * would differ from the one in the database and the schema diff would drop and recreate them.
 */
export class NamingStrategy extends UnderscoreNamingStrategy {
  override indexName(tableName: string, columns: string[], type: IndexType): string {
    const name = super.indexName(tableName, columns, type);
    if (type === 'primary' || name.length <= MAX_IDENTIFIER_LENGTH) return name;
    const hash = createHash('md5').update(name).digest('hex').slice(0, 5);
    return `${name.substring(0, MAX_IDENTIFIER_LENGTH - 8 - type.length)}_${hash}_${type}`;
  }
}
