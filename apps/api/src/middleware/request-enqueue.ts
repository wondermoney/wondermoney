import type { NextFunction, Request, Response } from 'express';

import { createRequestEnqueueAdapter, type Enqueue } from '@service/queue/enqueue';

declare module 'express-serve-static-core' {
  interface Request {
    /** Request-scoped enqueue seam. Set by `requestEnqueue`. */
    enqueue: Enqueue;
  }
}

/**
 * Attaches a request-scoped `req.enqueue`.
 *
 * Mounted once, after auth and before the route mounts. Building the adapter is cheap and touches
 * no database — the producer runtime is constructed lazily inside the first `send`, so requests that
 * enqueue nothing pay nothing.
 */
export const requestEnqueue = (req: Request, _res: Response, next: NextFunction): void => {
  req.enqueue = createRequestEnqueueAdapter({});
  next();
};
