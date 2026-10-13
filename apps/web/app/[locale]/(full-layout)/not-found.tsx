import NotFoundState from "@/components/error/NotFoundState";

// Boundary for `notFound()` calls raised by pages inside this route group
// (e.g. `accounts/[accountId]`, `budgets/[budgetId]/...`, `goals/[goalKey]`,
// `portfolio/[portfolioId]/...` for a deleted/unknown id). Rendering within
// this group keeps the authenticated app chrome (nav/sidebar) visible, since
// `app/[locale]/(full-layout)/layout.tsx` still wraps this boundary.
//
// This file previously rendered its own `<html>`/`<body>`, nested inside the
// `<html>`/`<body>` already rendered by the enclosing `app/[locale]/layout.tsx`
// — React's "nested <html>" mounting error and a blank page (RAD-642). Render
// only `<NotFoundState />` here; never add `<html>`/`<body>` back.
export default function NotFound() {
  return <NotFoundState />;
}
