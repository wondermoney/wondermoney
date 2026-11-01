import { buildSentryOptions } from '@service/sentry-options';

import * as Sentry from '@sentry/node';

// Imported first by both `app.ts` and `worker.ts`, so one config covers the API and the worker.
Sentry.init(buildSentryOptions());
