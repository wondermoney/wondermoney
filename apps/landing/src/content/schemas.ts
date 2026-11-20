/**
 * Frontmatter schemas of the learn content in `src/content/` (guides, glossary terms, monthly
 * indicators). `src/content.config.ts` binds them to the collections; they live in a plain
 * module so the tests can validate every file without Astro's virtual modules.
 *
 * Each document is one Markdown file per locale, `src/content/<collection>/<locale>/<slug>.md`:
 * the directory is the locale, the file name is the URL slug, and the Markdown body is the
 * article (a guide's text, a term's explanation, a monthly item's commentary).
 */
import { z } from "astro/zod";

/** A URL slug: lowercase ASCII words joined by hyphens. Slugs are routes, so never rename one. */
export const contentSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-words-with-hyphens");

const text = z.string().trim().min(1);

const referenceSchema = z
  .object({
    title: text.optional(),
    url: z.url().optional(),
    publisher: text.optional(),
  })
  .strict();

const seoFields = {
  /** The page title; defaults to the document's title followed by "— WonderMoney". */
  seoTitle: text.optional(),
  /** The meta description; defaults to the excerpt or definition. */
  seoDescription: text.optional(),
};

/**
 * Pairs the translations of one document across locales (hreflang alternates). Optional; a
 * document without one has no alternates, which is how every exported document arrived.
 */
const topicKey = text.optional();

export const guideSchema = z
  .object({
    title: text,
    excerpt: text,
    /** A `category.<key>` translation key, such as `budgeting` or `investing`. */
    category: text,
    publishedAt: z.coerce.date(),
    lastReviewedAt: z.coerce.date().optional(),
    /** Calculator keys such as `net-worth-calculator` (`resolveCalculatorRouteIdFromLegacy` in routes.ts), shown as "Keep reading" cards. */
    relatedCalculators: z.array(text).default([]),
    /** Slugs of glossary terms in the same locale. */
    relatedTerms: z.array(contentSlug).default([]),
    references: z.array(referenceSchema).default([]),
    /** An absolute image URL for social cards. */
    ogImage: z.url().optional(),
    topicKey,
    ...seoFields,
  })
  .strict();

const formulaSchema = z
  .object({
    title: text.optional(),
    expression: text.optional(),
    variables: z
      .array(
        z
          .object({
            label: text.optional(),
            name: text.optional(),
            symbol: text.optional(),
            meaning: text.optional(),
            value: z.union([z.string(), z.number()]).optional(),
          })
          .strict(),
      )
      .optional(),
    notes: text.optional(),
  })
  .strict();

const tableSchema = z
  .object({
    title: text.optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  })
  .strict();

export const glossaryTermSchema = z
  .object({
    term: text,
    /** One sentence; the hub card and the meta description use it. */
    definition: text,
    category: text,
    example: text.optional(),
    /** Shown instead of `definition` on the term's page when set. */
    plainDefinition: text.optional(),
    /** When set, it replaces the Markdown explanation on the page. */
    technicalDefinition: text.optional(),
    whyItMatters: text.optional(),
    /** Shown instead of `example`, under the "Mini example" heading. */
    miniExample: text.optional(),
    formula: formulaSchema.optional(),
    miniTable: tableSchema.optional(),
    references: z.array(referenceSchema).default([]),
    /** A calculator key such as `net-worth-calculator` (`resolveCalculatorRouteIdFromLegacy` in routes.ts). */
    relatedCalculator: text.optional(),
    /** The slug of a guide in the same locale. */
    relatedGuide: contentSlug.optional(),
    /** Slugs of other glossary terms in the same locale. */
    relatedTerms: z.array(contentSlug).default([]),
    topicKey,
    ...seoFields,
  })
  .strict();

export const monthlySchema = z
  .object({
    title: text,
    excerpt: text.optional(),
    year: z.number().int().min(2000),
    month: z.number().int().min(1).max(12),
    publishedAt: z.coerce.date().optional(),
    methodology: text.optional(),
    snapshotTable: tableSchema.optional(),
    trendChartConfig: z
      .object({
        title: text.optional(),
        chartType: z.enum(["line", "bar"]).optional(),
        series: z.array(z.object({ label: text, values: z.array(z.number()) }).strict()),
      })
      .strict()
      .optional(),
    changeVsPrevious: z
      .array(
        z
          .object({ metric: text, delta: z.number().optional(), unit: text.optional(), note: text.optional() })
          .strict(),
      )
      .default([]),
    whatChanged: z.array(z.object({ title: text.optional(), detail: text.optional() }).strict()).default([]),
    whoShouldCare: z.array(text).default([]),
    /** Listed under "References"; when absent, the data sources are listed there too. */
    references: z.array(referenceSchema).optional(),
    dataSources: z.array(referenceSchema).optional(),
    ogImage: z.url().optional(),
    ...seoFields,
  })
  .strict();

export type GuideData = z.output<typeof guideSchema>;
export type GlossaryTermData = z.output<typeof glossaryTermSchema>;
export type MonthlyData = z.output<typeof monthlySchema>;

/** The collections and the directory under `src/content/` each one reads. */
export const CONTENT_DIRECTORIES = {
  guides: "guides",
  glossary: "glossary",
  monthly: "monthly",
} as const;
