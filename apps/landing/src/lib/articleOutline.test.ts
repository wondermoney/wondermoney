import { describe, expect, it } from "vitest";
import { buildOutline, htmlToPlain, readingMinutes, sectionNumber } from "./articleOutline";

describe("readingMinutes", () => {
  it("rounds to whole minutes at 220 words a minute, never under one", () => {
    expect(readingMinutes([])).toBe(1);
    expect(readingMinutes(["word ".repeat(50)])).toBe(1);
    expect(readingMinutes(["word ".repeat(440)])).toBe(2);
    expect(readingMinutes(["word ".repeat(600), "  ", "word ".repeat(500)])).toBe(5);
  });

  it("counts words across scripts and punctuation", () => {
    expect(readingMinutes(["Poupança — três a seis meses, já!".repeat(220)])).toBeGreaterThan(1);
  });
});

describe("htmlToPlain", () => {
  it("keeps the text of each block on its own line", () => {
    const html = '<p>One <strong>two</strong> three</p>\n<ul>\n<li>four</li>\n<li><a href="/pt/learn">five</a></li>\n</ul>';
    expect(htmlToPlain(html)).toBe("One two three\nfour\nfive");
  });

  it("decodes the entities the Markdown renderer writes", () => {
    expect(htmlToPlain("<p>Juros &#x26; capital &lt;5% &quot;já&quot; &#233;</p>")).toBe('Juros & capital <5% "já" é');
  });

  it("is empty for an empty body", () => {
    expect(htmlToPlain("")).toBe("");
  });
});

describe("buildOutline", () => {
  it("gives each heading a unique, readable anchor", () => {
    expect(buildOutline(["How much you need", "Onde guardar o fundo?", "How much you need", ""])).toEqual([
      { id: "how-much-you-need", title: "How much you need" },
      { id: "onde-guardar-o-fundo", title: "Onde guardar o fundo?" },
      { id: "how-much-you-need-3", title: "How much you need" },
    ]);
  });

  it("falls back to a numbered anchor for a heading with no letters", () => {
    expect(buildOutline(["€€€"])).toEqual([{ id: "section-1", title: "€€€" }]);
  });
});

describe("sectionNumber", () => {
  it("pads to two digits", () => {
    expect(sectionNumber(0)).toBe("01");
    expect(sectionNumber(11)).toBe("12");
  });
});
