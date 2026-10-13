# @wondermoney/react-email

The API's email templates, written with [React Email](https://react.email). Each template
exports a render function that returns `{ subject, preheader, html, text }`; the API supplies
validated props and sends the result. Templates do not query, schedule or send anything.

A private workspace package: the API depends on it as `workspace:*`.

```bash
pnpm --filter @wondermoney/react-email dev          # preview the templates in the browser
pnpm --filter @wondermoney/react-email run check    # type-check, render every template, check the library
pnpm --filter @wondermoney/react-email build:lib    # compile dist/ for the API
```

Renderers require absolute `http(s)` URLs for every link and reject incomplete props, so a
broken email fails loudly instead of being sent. The preview data in `PreviewProps` and
`scripts/render-handoff.ts` is fictional and only for previews.

Templates are in English, Portuguese and Spanish where the API sends them in those
languages; add a translation alongside the existing ones.
