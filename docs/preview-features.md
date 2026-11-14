# Gating a feature behind preview features

A feature that is not ready for everyone does not need to live on a long branch. Ship it
behind the per-user **preview features** flag: the code is in `develop`, the API route is
closed to users without the flag, and the web and mobile entry points are hidden for them.
Anyone can turn the flag on in Settings to try it.

This guide covers the whole path: the preference store, the API gate, the client entry
points, translations, tests and the user documentation. The user-facing page is
`apps/docs/content/docs/{en,pt,es}/settings-security-privacy/preview-features.mdx`.

## 1. The preference store

Preferences live in `appuser.preferences`, a `jsonb` document validated by
`apps/api/src/validators/preferences.ts`. It is a document rather than a column per setting,
so adding a preference does not need a migration. `previewFeatures` is one of its keys:

```ts
export const userPreferencesSchema = z.object({
  aiHidden: z.boolean().default(false),
  dashboardLayout: dashboardLayoutSchema.default([]),
  previewFeatures: z.boolean().default(false),
});
```

- `GET /v1/user/me/preferences` returns the authenticated user's document.
- `PATCH /v1/user/me/preferences` takes a partial document. Each key is validated by the
  schema, unknown keys are dropped, and a patch with no known key is a `400`.
- The endpoint is self-scoped: the appuser comes from the session, never from a path
  parameter. One household member can never read or change the other's preferences.

The controller and service are `apps/api/src/controller/user-preferences.ts` and
`apps/api/src/services/preferences/user-preferences.service.ts`. Reads merge in defaults, so
a row written before a key existed still returns a complete document.

### Adding another preference key

1. Add the key to `userPreferencesSchema` (and to `patchUserPreferencesSchema` if clients may
   change it).
2. Add it to the web contract (`apps/web/lib/api/user-preferences/types.ts`) and the mobile
   contract (`apps/mobile/src/features/preferences/preview-features-contract.ts`).
3. No migration is needed: the column already holds any document the schema allows.

## 2. Gate the API route

Mount `requirePreviewFeatures` on the route that serves the feature. It must run after
`getUser`, which the `authedTenant` stack already does:

```ts
import { requirePreviewFeatures } from '@middleware/preview-features';

router.get('/labs/report', requirePreviewFeatures, getLabsReport);
```

A user without the flag gets **404**, the same answer as a route that does not exist, so the
feature is not discoverable from the API surface. A malformed stored document also fails
closed with 404 rather than 500.

Do not use `403` here: a 403 tells the caller the route exists and they lack a permission,
which is what this flag is designed to avoid.

## 3. Gate the web entry point

`usePreviewFeatures()` reads the flag and returns `false` while the preference is loading or
if it cannot be read, so a preview entry point never flashes for someone without the flag.

```tsx
import { PreviewGate } from "@/components/preview/PreviewGate";
import { PreviewPill } from "@/components/preview/PreviewPill";

<PreviewGate>
  <Link href="/labs/report">
    Labs report <PreviewPill />
  </Link>
</PreviewGate>;
```

- `<PreviewGate>` renders its children only when the flag is on. Pass `fallback` if the space
  should show something else instead of collapsing.
- `<PreviewPill>` is the small "Preview" tag for the entry point. Use it once per entry
  point, and keep the label identical to the one the feature uses elsewhere.
- For a whole page, gate the route's content the same way. The API route is still the
  authority: a saved link returns 404 for a user without the flag.

The Settings switch already exists in **Settings › Appearance › Preview features**
(`apps/web/components/settings/PreviewFeatures.tsx`). A new preview feature does not need its
own switch.

## 4. Gate the mobile entry point

Mobile uses the same preference through `usePreviewFeatures()` in
`apps/mobile/src/features/preferences/use-preview-features.ts`:

```tsx
const { enabled } = usePreviewFeatures();

return enabled ? <LabsReportRow /> : null;
```

The switch lives in **Settings › Appearance & Language › Preview features**
(`apps/mobile/src/features/preferences/preview-features-section.tsx`). The value is stored on
the account, so turning it on in web turns it on in mobile too.

## 5. Translations

Every user-facing string goes through the translation files, in English, Portuguese and
Spanish:

- Web: `apps/web/messages/{en,pt,es}/*.json`. The keys must match across the three locales;
  `apps/web/i18n/messages.test.ts` enforces it.
- Mobile: `apps/mobile/src/lib/i18n/resources/{en,pt-PT,es}.json`. Key parity is enforced by
  `apps/mobile/src/lib/i18n/i18n.test.ts`.
- Docs: `apps/docs/content/docs/{en,pt,es}/settings-security-privacy/preview-features.mdx`,
  with the page listed in each locale's `meta.json`.

Reuse the existing `preview` key for the pill rather than adding a second word for the same
concept.

## 6. Tests

The gate is a tenancy-adjacent boundary, so test it at each layer:

- **Validation**: unknown keys are dropped, wrong types are rejected, an empty patch is a
  400 (`apps/api/src/validators/__tests__/preferences.test.ts`).
- **Middleware**: 404 without the flag, pass-through with it, 401 without a user
  (`apps/api/src/middleware/__tests__/preview-features.test.ts`).
- **Endpoint**: GET/PATCH persist, invalid values do not, and one household member cannot
  read or change the other's document
  (`apps/api/src/controller/__tests__/user-preferences.http.test.ts`).
- **Web**: the gate hides and shows its children, the pill renders the translated label, and
  the switch sends the right patch (`components/preview/*.test.tsx`,
  `components/settings/PreviewFeatures.test.tsx`).
- **Mobile**: the contract, the hook and the switch
  (`apps/mobile/src/features/preferences/*.test.ts*`).

Run the API tests with a disposable Postgres:

```bash
cd apps/api
TEST_POSTGRES_URL=postgres://user:pass@localhost:5434/wmdb pnpm test
```

## Out of scope

The flag is deliberately simple. It does not do percentage rollouts, remote flag services or
instance-wide defaults. If a feature needs a staged rollout, that is a separate design
decision, not a reason to grow this one.
