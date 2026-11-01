import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Stop `next dev` writing its managed agent-rules block into AGENTS.md (Next 16.3+); the file
  // is hand-maintained and points at the bundled docs itself. See next-config-js/agentRules.
  agentRules: false,
  async redirects() {
    return [
      // RAD-574 — the screener was removed from the product (RAD-570: EODHD
      // serves /screener only above the tier we pay for). These pages were
      // indexed, so they redirect to the section index rather than 404. The
      // .md variants exist because proxy.ts serves a Markdown representation
      // of every docs page for LLM consumers.
      ...['en', 'pt', 'es'].flatMap((lang) => [
        {
          source: `/${lang}/docs/financial-markets/screener`,
          destination: `/${lang}/docs/financial-markets`,
          permanent: true,
        },
        {
          source: `/${lang}/docs/financial-markets/screener.md`,
          destination: `/${lang}/docs/financial-markets`,
          permanent: true,
        },
      ]),
      // WonderMoney became free: the billing section and the billing pages in
      // household and troubleshooting were removed. They were indexed, so they
      // redirect to the nearest section rather than 404.
      ...['en', 'pt', 'es'].flatMap((lang) => [
        {
          source: `/${lang}/docs/billing-subscription.md`,
          destination: `/${lang}/docs`,
          permanent: true,
        },
        {
          source: `/${lang}/docs/billing-subscription/:path*`,
          destination: `/${lang}/docs`,
          permanent: true,
        },
        ...['household/household-billing', 'troubleshooting/billing-problems'].flatMap((page) => {
          const section = page.split('/')[0];
          return [
            { source: `/${lang}/docs/${page}`, destination: `/${lang}/docs/${section}`, permanent: true },
            { source: `/${lang}/docs/${page}.md`, destination: `/${lang}/docs/${section}`, permanent: true },
          ];
        }),
      ]),
    ];
  },
};

export default withMDX(config);
