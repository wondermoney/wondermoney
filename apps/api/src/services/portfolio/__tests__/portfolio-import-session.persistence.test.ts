import { MetadataStorage } from '@mikro-orm/core';
import { describe, expect, it } from 'vitest';

import { PortfolioImportSession } from '@entity/PortfolioImportSession';

describe('portfolio import session persistence mapping', () => {
  it('maps s3 fields to snake_case columns', () => {
    const meta = Object.values(MetadataStorage.getMetadata()).find((candidate) => candidate.class === PortfolioImportSession) as { properties: Record<string, { fieldName?: string }> };
    const s3BucketProp = meta.properties['s3Bucket'] as { fieldName?: string };
    const s3KeyProp = meta.properties['s3Key'] as { fieldName?: string };

    expect(s3BucketProp.fieldName).toBe('s3_bucket');
    expect(s3KeyProp.fieldName).toBe('s3_key');
  });
});
