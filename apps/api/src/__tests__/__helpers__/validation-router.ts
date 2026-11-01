import express from 'express';
import { z } from 'zod';

import { zParse } from '@validators/parser';

const validatedRequestSchema = z.object({
  body: z.strictObject({
    amount: z.number().positive(),
    note: z.string().min(1),
  }),
});

/** A router whose one route runs a real schema through `zParse`, for error-response tests. */
export function validationRouter() {
  const router = express.Router();
  router.post('/validated', async (req, res) => {
    const { body } = await zParse(validatedRequestSchema, req);
    res.status(200).json(body);
  });
  return router;
}
