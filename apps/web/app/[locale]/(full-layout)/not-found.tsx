import NotFoundState from "@/components/error/NotFoundState";

// Boundary for `notFound()` calls raised by pages inside this route group
// (e.g. `accounts/[accountId]`, `budgets/[budgetId]/...`, `goals/[goalKey]`,
// `portfolio/[portfolioId]/...` for a deleted/unknown id). Rendering within
// this group keeps the authenticated app chrome (nav/sidebar) visible, since
// `app/[locale]/(full-layout)/layout.tsx` still wraps this boundary.
//
// The enclosing `app/[locale]/layout.tsx` already renders `<html>`/`<body>`;
// rendering them again here causes React's "nested <html>" mounting error and
// a blank page. Render only `<NotFoundState />` here; never add `<html>`/`<body>`.
export default function NotFound() {
  return <NotFoundState />;
}
