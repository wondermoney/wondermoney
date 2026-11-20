import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SAVINGS_CERTIFICATES_BASE_RATE } from "./data/savingsCertificatesRate";
import {
  LIST_URL,
  USER_AGENT,
  checkRate,
  latestNotice,
  parseNotice,
  parseNoticeList,
  refresh,
  renderModule,
  titleMonth,
} from "../../../scripts/build-savings-certificates-rate.mjs";

const NOVEMBER_URL = "https://www.igcp.pt/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-das-series-b-d-e-e-f-em-novembro-de-2026";

/** A row of IGCP's news list, as the page renders it. */
const row = (path: string, title: string, date = "30 Outubro 2026") => `
    <div class="views-row">
    <article data-history-node-id="474">
	<div class="news_teaser_wrapper">
		<div class="left_content">
            <div class="field field--name-field-news-category field--type-entity-reference field--label-hidden field__item">Aforristas</div>
			<div class="updated-date">
				${date}
			</div>
							<h3>
					<a href="${path}" rel="bookmark">
<span>${title}</span>
</a>
				</h3>
		</div>
	</div>
</article>
  </div>`;

const LIST = `<html><body><a href="/pt/noticias">Notícias</a>
${row("/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-das-series-b-d-e-e-f-em-novembro-de-2026", "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em novembro de 2026")}
${row("/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-das-series-b-d-e-e-f-em-outubro-2026", "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em outubro 2026", "29 Setembro 2026")}
${row("/pt/noticias/alteracao-dos-limites", "Alteração dos limites máximos dos valores de subscrição Certificados de Aforro da Série F")}
</body></html>`;

/** A notice page: the title, its summary and date, and a related-news teaser whose summary has the wrong year. */
const notice = ({
  title = "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em novembro de 2026",
  summary = "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em novembro  de 2026 foi fixada em 2,500%",
  date = "30 Outubro 2026",
} = {}) => `<html><head>
<meta name="description" content="A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em novembro de 2025 foi fixada em 2,500%." />
</head><body>
          <h1 class="page-title">
            ${title}
          </h1>
                      <div class="content_description">

            <div class="field field--name-field-news-description field--type-string-long field--label-hidden field__item">${summary}</div>

            </div>
                    <div class="content_date">
            Informação atualizada em
            ${date}
          </div>
        </div>
          <div class="related-news">
            <h2>Notícias Relacionadas</h2>
            <span>Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em outubro 2026</span>
            A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em novembro de 2025 foi fixada em 2,500%.
          </div>
</body></html>`;

describe("build-savings-certificates-rate", () => {
  it("reads the month from both title forms IGCP uses", () => {
    expect(titleMonth("Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em novembro de 2026")).toBe("2026-11");
    expect(titleMonth("Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em outubro 2026")).toBe("2026-10");
    expect(titleMonth("Taxas de Juro dos Certificados de Aforro das Séries B, D, E e F em março de 2027")).toBe("2027-03");
    expect(titleMonth("Alteração dos limites máximos dos valores de subscrição Certificados de Aforro da Série F")).toBeNull();
    expect(titleMonth("Taxas de Juro dos Certificados de Aforro em brumário de 2026")).toBeNull();
  });

  it("lists the rate notices only and picks the newest month", () => {
    const notices = parseNoticeList(LIST);
    expect(notices.map((entry) => entry.month)).toEqual(["2026-11", "2026-10"]);
    expect(latestNotice([...notices].reverse())).toEqual({
      url: NOVEMBER_URL,
      title: "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em novembro de 2026",
      month: "2026-11",
    });
    expect(() => parseNoticeList("<html></html>")).toThrow(/no Série F rate notice/);
  });

  it("reads the rate, month and date from the notice's own summary, not the meta tag or the teasers", () => {
    expect(parseNotice(notice())).toEqual({ month: "2026-11", rate: 2.5, publishedOn: "2026-10-30" });
    expect(parseNotice(notice({
      title: "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em dezembro de 2026",
      summary: "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em dezembro de 2026 foi fixada em 2,381%",
      date: "26 Novembro 2026",
    }))).toEqual({ month: "2026-12", rate: 2.381, publishedOn: "2026-11-26" });
  });

  it.each([
    ["a summary for another month", { summary: "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em outubro de 2026 foi fixada em 2,500%" }, /title names 2026-11 but the summary 2026-10/],
    ["a summary with no rate", { summary: "As taxas foram atualizadas." }, /no Série F rate/],
    ["a rate with four decimals", { summary: "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em novembro de 2026 foi fixada em 2,5001%" }, /more than three decimals/],
    ["a title with no month", { title: "Certificados de Aforro" }, /names no month/],
    ["no date", { date: "ontem" }, /no publication date/],
  ])("refuses %s", (_, parts, error) => {
    expect(() => parseNotice(notice(parts))).toThrow(error);
  });

  it("accepts a rate within the band for the fetch month or the next, and refuses the rest", () => {
    const november = { month: "2026-11", rate: 2.5, publishedOn: "2026-10-30" };
    expect(checkRate(november, { fetchedOn: "2026-11-20" })).toEqual(november);
    expect(checkRate(november, { fetchedOn: "2026-10-30" })).toEqual(november);
    expect(checkRate({ ...november, rate: 0 }, { fetchedOn: "2026-11-20" }).rate).toBe(0);
    expect(() => checkRate({ ...november, rate: 2.51 }, { fetchedOn: "2026-11-20" })).toThrow(/outside the 0% to 2.5% band/);
    expect(() => checkRate({ ...november, rate: -0.1 }, { fetchedOn: "2026-11-20" })).toThrow(/outside/);
    expect(() => checkRate(november, { fetchedOn: "2026-12-06" })).toThrow(/before 2026-12: stale/);
    expect(() => checkRate(november, { fetchedOn: "2026-09-30" })).toThrow(/after 2026-10/);
    expect(() => checkRate(november, { fetchedOn: "2026-10-29" })).toThrow(/after the fetch date/);
    expect(checkRate({ month: "2027-01", rate: 2.4, publishedOn: "2026-12-28" }, { fetchedOn: "2026-12-29" }).month).toBe("2027-01");
  });

  it("renders the committed module, which matches the live IGCP notice of November 2026", () => {
    const rendered = renderModule({ month: "2026-11", rate: 2.5, publishedOn: "2026-10-30", url: NOVEMBER_URL }, { fetchedOn: "2026-11-20" });
    expect(rendered).toContain('month: "2026-11"');
    expect(rendered).toContain("rate: 2.5,");
    expect(SAVINGS_CERTIFICATES_BASE_RATE.rate).toBeGreaterThanOrEqual(0);
    expect(SAVINGS_CERTIFICATES_BASE_RATE.rate).toBeLessThanOrEqual(2.5);
    expect(SAVINGS_CERTIFICATES_BASE_RATE.source).toMatch(/^https:\/\/www\.igcp\.pt\/pt\/noticias\//);
  });

  describe("refresh", () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    const tempOut = (content: string) => {
      const dir = mkdtempSync(join(tmpdir(), "savings-rate-"));
      dirs.push(dir);
      const out = join(dir, "savingsCertificatesRate.ts");
      writeFileSync(out, content);
      return out;
    };
    const fakeFetch = (pages: Record<string, string>, seen: { url: string; agent: string | null }[] = []) =>
      (async (url: string, init?: RequestInit) => {
        seen.push({ url, agent: new Headers(init?.headers).get("User-Agent") });
        const body = pages[url];
        return new Response(body ?? "not found", { status: body === undefined ? 404 : 200 });
      }) as unknown as typeof fetch;

    it("fetches the list and the newest notice with the site's User-Agent, then writes the module", async () => {
      const out = tempOut("old");
      const seen: { url: string; agent: string | null }[] = [];
      const rate = await refresh({ fetchImpl: fakeFetch({ [LIST_URL]: LIST, [NOVEMBER_URL]: notice() }, seen), fetchedOn: "2026-11-20", out });
      expect(rate).toEqual({ month: "2026-11", rate: 2.5, publishedOn: "2026-10-30", url: NOVEMBER_URL });
      expect(seen).toEqual([{ url: LIST_URL, agent: USER_AGENT }, { url: NOVEMBER_URL, agent: USER_AGENT }]);
      expect(readFileSync(out, "utf8")).toBe(renderModule(rate, { fetchedOn: "2026-11-20" }));
    });

    it.each([
      ["the list fails", { [NOVEMBER_URL]: notice() }, /answered 404/],
      ["the notice fails", { [LIST_URL]: LIST }, /answered 404/],
      ["the notice is for another month than the list says", { [LIST_URL]: LIST, [NOVEMBER_URL]: notice({
        title: "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em outubro de 2026",
        summary: "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em outubro de 2026 foi fixada em 2,500%",
      }) }, /list names 2026-11 but the notice 2026-10/],
    ])("leaves the file untouched when %s", async (_, pages, error) => {
      const out = tempOut("old");
      await expect(refresh({ fetchImpl: fakeFetch(pages), fetchedOn: "2026-11-20", out })).rejects.toThrow(error);
      expect(readFileSync(out, "utf8")).toBe("old");
    });

    it("leaves the file untouched when the newest notice is stale", async () => {
      const out = tempOut("old");
      await expect(refresh({ fetchImpl: fakeFetch({ [LIST_URL]: LIST, [NOVEMBER_URL]: notice() }), fetchedOn: "2026-12-06", out }))
        .rejects.toThrow(/stale/);
      expect(readFileSync(out, "utf8")).toBe("old");
    });
  });
});
