import { describe, expect, it } from "vitest";
import { TERM_DEPOSIT_OFFERS, TERM_DEPOSIT_OFFERS_AS_OF } from "./data/termDepositOffers";
import { DEFAULT_OFFER_FILTERS, filterOffers, offerReturn, offerTerms, sortOffers } from "./termDepositOffers";

const find = (bank: string, term: number, product?: string) => {
  const hit = TERM_DEPOSIT_OFFERS.find((o) => o.bank === bank && o.termMonths === term && (!product || o.product === product));
  if (!hit) throw new Error(`missing ${bank} ${term}`);
  return hit;
};

describe("term deposit offers data", () => {
  it("pins the date and the row count of the owner's table", () => {
    expect(TERM_DEPOSIT_OFFERS_AS_OF).toBe("2026-11-19");
    expect(TERM_DEPOSIT_OFFERS).toHaveLength(49);
  });

  it("transcribes distinctive rows", () => {
    expect(find("BiG", 3)).toMatchObject({
      tanb: 4, minimum: 5000, maximum: 50000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false,
    });
    expect(find("Haitong Bank", 12, "Depósito premium")).toMatchObject({
      tanb: 3.35, minimum: 50000, maximum: null, earlyWithdrawal: "seeNotes", notes: "3,30% mobilizável",
    });
    expect(find("BluOr Bank", 60)).toMatchObject({ tanb: 3, irsNotWithheld: true, minimum: 1000, maximum: null });
    expect(find("Finantia", 24, "Visão")).toMatchObject({ tanb: 3.15, newMoney: true, earlyWithdrawal: "yes" });
    expect(find("Klarna", 18).notes).toBe("");
    expect(find("BNI Europa", 36).notes.split("\n")).toHaveLength(3);
  });

  it("repeats merged TANB and term cells on every row they span", () => {
    expect(TERM_DEPOSIT_OFFERS.filter((o) => o.tanb === 3).length).toBe(24);
    expect(TERM_DEPOSIT_OFFERS.filter((o) => o.tanb === 3.5).map((o) => o.bank)).toEqual(["ActivoBank", "BiG"]);
    expect(offerTerms()).toEqual([3, 6, 9, 12, 18, 24, 36, 48, 60]);
  });
});

describe("filtering and sorting", () => {
  it("sorts by TANB descending", () => {
    const sorted = sortOffers(TERM_DEPOSIT_OFFERS);
    expect(sorted[0].bank).toBe("BiG");
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1].tanb).toBeGreaterThanOrEqual(sorted[i].tanb);
  });

  it("hides rows whose minimum is above or maximum is below the amount", () => {
    const at1000 = filterOffers({ ...DEFAULT_OFFER_FILTERS, amount: 1000 });
    expect(at1000.some((o) => o.minimum !== null && o.minimum > 1000)).toBe(false);
    const big = filterOffers({ ...DEFAULT_OFFER_FILTERS, amount: 200_000 });
    expect(big.some((o) => o.maximum !== null && o.maximum < 200_000)).toBe(false);
    expect(big.some((o) => o.bank === "Banco CTT")).toBe(true);
    expect(filterOffers({ ...DEFAULT_OFFER_FILTERS, amount: Number.NaN })).toHaveLength(49);
  });

  it("applies the client, new-money, early-withdrawal, IRS and term filters", () => {
    const all = { ...DEFAULT_OFFER_FILTERS, amount: Number.NaN };
    expect(filterOffers({ ...all, existingClients: true }).every((o) => !o.newClients)).toBe(true);
    expect(filterOffers({ ...all, noNewMoney: true }).every((o) => !o.newMoney)).toBe(true);
    expect(filterOffers({ ...all, earlyWithdrawal: true }).every((o) => o.earlyWithdrawal !== "no")).toBe(true);
    expect(filterOffers({ ...all, irs: "notWithheld" }).every((o) => o.irsNotWithheld)).toBe(true);
    expect(filterOffers({ ...all, irs: "withheld" }).some((o) => o.irsNotWithheld)).toBe(false);
    expect(filterOffers({ ...all, termMonths: 60 }).map((o) => o.bank)).toEqual(["BNI Europa", "BluOr Bank"]);
  });
});

describe("offerReturn", () => {
  it("reuses the term deposit engine: 4% for 3 months on 10,000 nets 72.00 after 28% IRS", () => {
    const result = offerReturn(find("BiG", 3), 10_000);
    expect(result?.grossInterest).toBe(100);
    expect(result?.netInterest).toBe(72);
    expect(result?.netAnnualYield).toBeCloseTo(((1 + 72 / 10_000) ** 4 - 1) * 100, 6);
  });

  it("returns null for an invalid amount", () => {
    expect(offerReturn(find("BiG", 3), Number.NaN)).toBeNull();
  });
});
