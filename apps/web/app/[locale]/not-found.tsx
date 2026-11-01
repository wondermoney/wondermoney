import NotFoundState from "@/components/error/NotFoundState";

// Boundary for any route matched inside a valid `[locale]` segment that has no
// page — most commonly the catch-all in `app/[locale]/[...rest]/page.tsx`,
// which calls `notFound()` for every unmatched, locale-prefixed URL. Without
// this file, Next.js has nowhere closer to bubble to than the root
// `app/not-found.tsx`, which renders its own `<html>`/`<body>` — nested inside
// the `<html>`/`<body>` that `app/[locale]/layout.tsx` has already rendered
// for this (valid-locale) request, producing React's "nested <html>" mounting
// error and a blank page. This file intentionally renders only
// `<NotFoundState />`, no `<html>`/`<body>` of its own.
export default function NotFound() {
  return <NotFoundState />;
}
