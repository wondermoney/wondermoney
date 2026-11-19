# Hairline figures

The line figures on the long-form pages (learn guides, the savings and net worth guides, and the
thumbnails on the hubs and "Keep reading" cards). No npm dependency: the engine is vendored.

| File | What |
|---|---|
| `kernel.js` | The Hairline kernel (MIT, Lucas Marques; `LICENSE` beside it), copied from the hairline-create skill's `kernel.js`, its first line the upstream sha. Unchanged except `export default HL;` appended at the end. To update it, copy the new file and append that line again. |
| `figures/<name>.js` | One figure each, in the skill's format: a script that destructures `HL` and ends with `hairline({ name, means, rules, range, tour, mount })`. Keep that format, so the skill's checker (`validate.mjs`) still runs on them. |
| `mount.ts` | Sets `globalThis.HL` and `globalThis.hairline` and imports a figure file only when its box nears the viewport; the kernel and each figure are their own lazy chunks. Mounts at the middle of the figure's `range`; the corner read-out is never shown and the tour never runs (no autoplay). |
| `articleFigures.ts` | Which figure each article and hub card shows, and `PENDING`: the names with no file yet, drawn as `jar` and described as `jar` until they land. |
| `../../components/shared/HairlineFigure.astro` | The 5:4 box: sized on the server (no layout shift), `role="img"` with the localized label, or `aria-hidden` as a thumbnail. Themed from the site tokens in `globals.css` (`.hl-figure`). |

## Adding a figure

1. Put the file at `figures/<name>.js`, with `name: "<name>"` in its `hairline({ … })` call.
2. Take `<name>` out of `PENDING` in `articleFigures.ts`.
3. Check its label, `hairline.labels.<name>`, in `src/locales/*/common.json` and
   `public/locales/*/common.json` (six locales each), against what the figure draws.
4. `../../node_modules/.bin/vitest run src/lib/hairline` from `apps/landing`: it fails while a
   file and `PENDING` disagree.

A figure sets no colour of its own: the kernel's classes (`sil`, `hi`, `lo`, …) take the
`--hairline-*` properties, which `globals.css` maps to the page's tokens.
