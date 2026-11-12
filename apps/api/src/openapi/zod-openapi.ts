import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * Adds the `.openapi({ refId })` method to Zod. Import this module *before* any schema that
 * carries a `refId` is created — including `@validators/financial-markets-dtos`, whose response
 * schemas are reused by the public reference.
 */
extendZodWithOpenApi(z);
