import { describe, expect, it } from "vitest";
import type { GlossaryTermData, GuideData, MonthlyData } from "@/content/schemas";
import {
  buildGlossaryTerms,
  buildGuides,
  buildMonthlyItems,
  entryPath,
  topicAlternateLinks,
  type ContentEntry,
} from "./contentEntries";

const guide = (id: string, data: Partial<GuideData> = {}): ContentEntry<GuideData> => ({
  id,
  data: {
    title: `Guide ${id}`,
    excerpt: "Excerpt",
    category: "budgeting",
    publishedAt: new Date("2026-03-01T09:00:00.000Z"),
    relatedCalculators: [],
    relatedTerms: [],
    references: [],
    ...data,
  },
  rendered: { html: "<p>First paragraph.</p>\n<p>Second &#x26; last.</p>" },
});

const term = (id: string, data: Partial<GlossaryTermData> = {}): ContentEntry<GlossaryTermData> => ({
  id,
  data: { term: `Term ${id}`, definition: "Definition", category: "budgeting", relatedTerms: [], references: [], ...data },
});

const month = (id: string, year: number, monthNumber: number): ContentEntry<MonthlyData> => ({
  id,
  data: { title: id, year, month: monthNumber, changeVsPrevious: [], whatChanged: [], whoShouldCare: [] },
});

describe("entryPath", () => {
  it("reads the locale and slug from the entry id", () => {
    expect(entryPath("pt/taxa-de-esforco")).toEqual({ locale: "pt", slug: "taxa-de-esforco" });
  });

  it.each(["xx/taeg", "taeg", "pt/sub/taeg", "pt/"])("rejects %s", (id) => {
    expect(() => entryPath(id)).toThrow(/<locale>\/<slug>\.md/);
  });
});

describe("buildGuides", () => {
  it("lists the newest guide first, with dates as ISO strings and the body as plain text", () => {
    const guides = buildGuides(
      [guide("en/older", { publishedAt: new Date("2026-01-01T00:00:00.000Z") }), guide("en/newer")],
      [],
    );
    expect(guides.map((entry) => entry.slug)).toEqual(["newer", "older"]);
    expect(guides[0]).toMatchObject({
      id: "en/newer",
      locale: "en",
      publishedAt: "2026-03-01T09:00:00.000Z",
      bodyText: "First paragraph.\nSecond & last.",
    });
  });

  it("resolves related terms in the guide's locale, keeping their order", () => {
    const [entry] = buildGuides(
      [guide("pt/orcamento-mensal", { relatedTerms: ["taeg", "orcamento"] })],
      [term("pt/orcamento", { term: "Orçamento" }), term("pt/taeg", { term: "TAEG" }), term("en/taeg")],
    );
    expect(entry.relatedTerms).toEqual([
      { slug: "taeg", term: "TAEG", locale: "pt" },
      { slug: "orcamento", term: "Orçamento", locale: "pt" },
    ]);
  });

  it("fails on a related term that has no file in the same locale", () => {
    expect(() => buildGuides([guide("pt/plano", { relatedTerms: ["budget"] })], [term("en/budget")])).toThrow(
      'guides/pt/plano refers to glossary "budget", which has no file at glossary/pt/budget.md',
    );
  });

  it("accepts a calculator by its key, its slug in the guide's locale or its route id", () => {
    const [entry] = buildGuides(
      [guide("pt/plano", { relatedCalculators: ["debt-to-income-calculator", "credito-habitacao", "toolInvestorProfile"] })],
      [],
    );
    expect(entry.relatedCalculators).toEqual(["debt-to-income-calculator", "credito-habitacao", "toolInvestorProfile"]);
  });

  it("fails on a related calculator that names no tool, instead of falling back to the tools hub", () => {
    expect(() => buildGuides([guide("en/plan", { relatedCalculators: ["mortgage-calculator", "debt-payoff-calculator"] })], [])).toThrow(
      'guides/en/plan names the calculator "debt-payoff-calculator", which is no tool',
    );
  });
});

describe("buildGlossaryTerms", () => {
  it("sorts by term with accents folded, upper case before lower case as before", () => {
    const terms = buildGlossaryTerms(
      [
        term("pt/rebalanceamento", { term: "Rebalanceamento" }),
        term("pt/racio-pl", { term: "Rácio P/L" }),
        term("en/amortization", { term: "Amortization" }),
        term("en/apr", { term: "APR" }),
      ],
      [],
    );
    expect(terms.map((entry) => entry.term)).toEqual(["APR", "Amortization", "Rácio P/L", "Rebalanceamento"]);
  });

  it("resolves the related guide's title and the related terms in the same locale", () => {
    const terms = buildGlossaryTerms(
      [term("pt/taeg", { term: "TAEG", relatedGuide: "credito", relatedTerms: ["tanb"] }), term("pt/tanb", { term: "TANB" })],
      [guide("pt/credito", { title: "Crédito" })],
    );
    const entry = terms.find((candidate) => candidate.slug === "taeg");
    expect(entry).toMatchObject({
      relatedGuideSlug: "credito",
      relatedGuideTitle: "Crédito",
      relatedTerms: [{ slug: "tanb", term: "TANB", locale: "pt" }],
      bodyText: "",
    });
  });

  it("fails on a related calculator that names no tool", () => {
    expect(() => buildGlossaryTerms([term("pt/taxa-de-esforco", { relatedCalculator: "loan-payoff" })], [])).toThrow(
      'glossary/pt/taxa-de-esforco names the calculator "loan-payoff", which is no tool',
    );
  });

  it("accepts the FIRE calculator page as a related calculator", () => {
    const [entry] = buildGlossaryTerms([term("en/fire", { relatedCalculator: "fire" })], []);
    expect(entry.relatedCalculator).toBe("fire");
  });

  it("fails on a related guide in another locale", () => {
    expect(() => buildGlossaryTerms([term("pt/taeg", { relatedGuide: "credit" })], [guide("en/credit")])).toThrow(
      'glossary/pt/taeg refers to guides "credit"',
    );
  });
});

describe("buildMonthlyItems", () => {
  it("lists the latest month first", () => {
    const items = buildMonthlyItems([month("pt/a", 2026, 2), month("pt/b", 2026, 11), month("pt/c", 2025, 12)]);
    expect(items.map((item) => item.slug)).toEqual(["b", "a", "c"]);
  });
});

describe("topicAlternateLinks", () => {
  const pathFor = (locale: string, slug: string) => `/${locale}/learn/${slug}`;

  it("links the translations that share a topic key", () => {
    const pt = { locale: "pt" as const, slug: "fundo-de-emergencia", topicKey: "emergency-fund" };
    const en = { locale: "en" as const, slug: "emergency-fund-guide", topicKey: "emergency-fund" };
    const other = { locale: "en" as const, slug: "etf-investing-beginners", topicKey: "etf" };
    expect(topicAlternateLinks(pt, [pt, en, other], pathFor)).toEqual([
      { hrefLang: "pt", href: "https://wonder.money/pt/learn/fundo-de-emergencia" },
      { hrefLang: "en", href: "https://wonder.money/en/learn/emergency-fund-guide" },
    ]);
  });

  it("has none without a topic key or a translation", () => {
    const alone = { locale: "pt" as const, slug: "a", topicKey: "only" };
    expect(topicAlternateLinks({ locale: "pt", slug: "b" }, [alone], pathFor)).toEqual([]);
    expect(topicAlternateLinks(alone, [alone], pathFor)).toEqual([]);
  });
});
