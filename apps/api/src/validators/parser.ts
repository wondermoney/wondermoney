import type { Request } from 'express';
import { type AnyZodObject, z, ZodError } from 'zod';
import { fromZodError } from 'zod-validation-error';

import { BadRequestError, InternalServerError } from '@utils/errors';

export async function zParse<T extends AnyZodObject>(schema: T, req: Request): Promise<z.infer<T>> {
  try {
    return await schema.parseAsync(req);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestError(fromZodError(error).toString());
    }
    const err = new InternalServerError('An unexpected error occurred');
    err.stack = error instanceof Error ? error.stack : undefined;
    throw err;
  }
}
