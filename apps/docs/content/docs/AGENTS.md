# Documentation content conventions

## Localized content

- Each page has paired `en`, `pt`, and `es` siblings under `content/docs/`. Never ship a change to one locale without verifying the other two.
- Locale navigation order is defined per-section in each section's `meta.json`. Add new pages there, not just on disk.

## Images

- **Required:** `alt` text on every image. No decorative-only images without `alt=""` (and only if the image is truly decorative).
- **Recommended:** a one-line caption that names what the reader is looking at.
- **Format:** PNG only. Do not use SVG for UI captures.
- **Resolution:** capture at 2× device scale on a 1440×900 viewport.
- **Path convention:** `/images/docs/<section>/<page-slug>-<step>.png` (where `<step>` is a short kebab-case name like `overview`, `pick-bank`, `review-transaction`). The file lives at `apps/docs/public/images/docs/<section>/<page-slug>-<step>.png`.
- **Aspect ratio:** include `width` and `height` props so the renderer reserves space and avoids layout shift.

## How to add a new screenshot

1. Capture the raw full-page PNG into `dogfood-output/docs-screens/<section>/<page-slug>-<step>.png` at the repository root (gitignored); `scripts/capture-screens.ts` automates this.
2. Crop to the relevant UI bounds with `scripts/crop-screens.ts`, which writes the cropped PNG to `public/images/docs/<section>/<page-slug>-<step>.png`.
3. Add a `<DocsImage>` reference in the matching MDX file under `content/docs/en/`. Include `alt`, `width`, `height`, and a one-line `caption`.
4. Mirror the reference in the matching `content/docs/pt/` and `content/docs/es/` files when the corresponding screenshot has been captured in that locale.
5. Run `pnpm --filter @wondermoney/docs type-check` and `build` to confirm no broken refs.
