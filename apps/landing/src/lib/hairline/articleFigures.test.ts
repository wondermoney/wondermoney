import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  FIGURE_NAMES,
  PENDING,
  RESOURCE_CARD_FIGURES,
  figureForGuide,
  figureForResource,
  figureForTool,
  resolveFigure,
} from "./articleFigures";

const delivered = readdirSync(new URL("./figures", import.meta.url))
  .filter((file) => file.endsWith(".js"))
  .map((file) => file.slice(0, -3));

describe("article figure registry", () => {
  it("has a figure file for every name that is not pending, and no file for a pending one", () => {
    for (const name of FIGURE_NAMES) {
      expect(delivered.includes(name), name).toBe(!PENDING.includes(name));
    }
    for (const file of delivered) expect(FIGURE_NAMES).toContain(file);
  });

  it("names each figure file after the figure it declares", () => {
    for (const name of delivered) {
      const source = readFileSync(new URL(`./figures/${name}.js`, import.meta.url), "utf8");
      const call = source.slice(source.lastIndexOf("hairline({"));
      expect(call).toMatch(new RegExp(`name:\\s*["'\`]${name}["'\`]`));
    }
  });

  it("draws the delivered stand-in, and describes it, while a figure is pending", () => {
    for (const name of FIGURE_NAMES) {
      const figure = resolveFigure(name);
      expect(delivered).toContain(figure.name);
      expect(figure.name).toBe(PENDING.includes(name) ? "jar" : name);
      expect(figure.labelKey).toBe(`hairline.labels.${figure.name}`);
    }
  });

  it.each(SUPPORTED_LANGS)("labels every figure in %s", (locale) => {
    const t = getTranslations(locale);
    for (const name of FIGURE_NAMES) {
      const key = `hairline.labels.${name}`;
      expect(t(key), key).not.toBe(key);
      expect(t(key).trim().length).toBeGreaterThan(10);
    }
  });

  it("maps each learn guide, in English and Portuguese, to its subject", () => {
    expect(figureForGuide("emergency-fund-guide")).toBe("jar");
    expect(figureForGuide("fundo-de-emergencia")).toBe("jar");
    expect(figureForGuide("build-monthly-budget")).toBe("envelopes");
    expect(figureForGuide("como-criar-orcamento-mensal")).toBe("envelopes");
    expect(figureForGuide("debt-payoff-plan")).toBe("snowball");
    expect(figureForGuide("plano-para-pagar-dividas")).toBe("snowball");
    expect(figureForGuide("diversification-portfolio")).toBe("eggs");
    expect(figureForGuide("etf-investing-beginners")).toBe("etfbox");
    expect(figureForGuide("inflacao-e-rendimento-real")).toBe("inflation");
    expect(figureForGuide("open-banking-e-seguranca")).toBe("doorchain");
    expect(figureForGuide("planeamento-fiscal-investidores")).toBe("taxwedge");
    expect(figureForGuide("a-guide-nobody-mapped")).toBeUndefined();
  });

  it("gives every resources hub card a figure", () => {
    expect(figureForResource("emergency_fund")).toBe("jar");
    expect(figureForResource("savings_guide")).toBe("containers");
    expect(figureForResource("tools")).toBe("calculator");
    expect(figureForResource("guides")).toBe("booklets");
    expect(figureForResource("something_new")).toBe("booklets");
    for (const name of Object.values(RESOURCE_CARD_FIGURES)) expect(FIGURE_NAMES).toContain(name);
  });

  it("gives a calculator its subject's figure when there is one", () => {
    expect(figureForTool("toolEmergencyFund")).toBe("jar");
    expect(figureForTool("toolHouseholdBudget")).toBe("envelopes");
    expect(figureForTool("toolCompoundInterest")).toBe("snowball");
    expect(figureForTool("toolSavingsGoal")).toBe("containers");
    expect(figureForTool("toolSavingsRate")).toBe("jar");
    expect(figureForTool("toolNetWorth")).toBe("scale");
    expect(figureForTool("toolDebtToIncome")).toBe("scale");
    expect(figureForTool("toolInvestorProfile")).toBe("riskdial");
    expect(figureForTool("toolMortgage")).toBe("house");
    expect(figureForTool("toolNetSalary")).toBe("payslip");
    expect(figureForTool("toolSomethingNew")).toBe("calculator");
    expect(figureForTool(undefined)).toBe("calculator");
  });
});
