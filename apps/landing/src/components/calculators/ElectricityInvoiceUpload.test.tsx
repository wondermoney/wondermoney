// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDP_SIMPLE, UNKNOWN_SUPPLIER } from "@/lib/calculators/electricityInvoice.fixtures";
import { FIXTURE_OFFERS } from "@/lib/calculators/electricityTariffComparison.fixtures";
import type { OffersLoader } from "./ElectricityTariffComparisonComp";

// pdf.js is not run here: the PDF's text is what the mock returns for the chosen file's name.
const pdfLines = vi.fn<(data: Uint8Array) => Promise<string[]>>();
vi.mock("@/lib/calculators/invoicePdf", async (original) => ({
  ...(await original<typeof import("@/lib/calculators/invoicePdf")>()),
  readInvoicePdfLines: (data: Uint8Array) => pdfLines(data),
}));
vi.mock("@/lib/gtm", () => ({ pushGtmEvent: () => {}, getPageType: () => "tools/electricity-tariff-comparison" }));

const { default: ElectricityTariffComparisonComp } = await import("./ElectricityTariffComparisonComp");
const { InvoicePdfError } = await import("@/lib/calculators/invoicePdf");

const loadFixtures: OffersLoader = async () => ({
  ELECTRICITY_OFFERS: FIXTURE_OFFERS,
  ELECTRICITY_OFFERS_SOURCE: { url: "https://simuladorprecos.erse.pt/", exportedOn: "2026-11-17", offerCount: FIXTURE_OFFERS.length, supplierCount: 3 },
});

async function renderPage() {
  render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadFixtures} />);
  await screen.findByRole("list", { name: "Offers, cheapest first" });
}

/** Every value the form holds, to see that it did not change. */
function formValues() {
  const form = screen.getByRole("form", { name: "Your consumption and contract" });
  return [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=file]), select")].map((field) =>
    field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") ? `${field.id || field.name}=${field.checked}` : `${field.id}=${field.value}`,
  );
}

const choose = (lines: string[] | Error, name = "invoice.pdf", size = 1000) => {
  if (lines instanceof Error) pdfLines.mockRejectedValueOnce(lines);
  else pdfLines.mockResolvedValueOnce(lines);
  fireEvent.change(screen.getByLabelText("Invoice PDF"), { target: { files: [new File([new Uint8Array(size)], name, { type: "application/pdf" })] } });
};

beforeEach(() => pdfLines.mockReset());
afterEach(() => cleanup());

describe("reading an invoice into the comparator", () => {
  it("says the file stays on the device and which suppliers it reads", async () => {
    await renderPage();
    expect(screen.getByText("The file stays on your device: it is read in this browser and never uploaded.")).toBeTruthy();
    expect(screen.getByText(/from these suppliers: EDP, Endesa, Galp, Goldenergy, and Iberdrola\./)).toBeTruthy();
  });

  it("shows what it read and fills the form only when asked", async () => {
    await renderPage();
    const before = formValues();
    choose(EDP_SIMPLE);
    expect(await screen.findByText("Read from the invoice (EDP):")).toBeTruthy();
    const review = screen.getByText("Read from the invoice (EDP):").parentElement as HTMLElement;
    const shown = [...review.querySelectorAll("dt")].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`);
    expect(shown).toEqual([
      "Contracted power: 4.60 kVA",
      "Tariff option: Simple",
      "Days billed: 30",
      "Consumption: 160 kWh",
      "Power price: 0.2900 €/day",
      "Energy price: 0.1900 €/kWh",
    ]);
    expect(formValues()).toEqual(before);

    fireEvent.click(within(review).getByRole("button", { name: "Fill in the form" }));
    expect(screen.getByText(/The form now holds your invoice's figures/)).toBeTruthy();
    expect((screen.getByLabelText("Contracted power") as HTMLSelectElement).value).toBe("4.6");
    expect((screen.getByLabelText("Full") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("The consumption covers") as HTMLSelectElement).value).toBe("days");
    expect((screen.getByLabelText("Number of days") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Energy") as HTMLInputElement).value).toBe("160");
    expect((screen.getByLabelText("Use my prices") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Power price") as HTMLInputElement).value).toBe("0.29");
    expect((screen.getByLabelText("Energy price") as HTMLInputElement).value).toBe("0.19");
  });

  it("leaves the form as it was on an unsupported invoice, and on discard", async () => {
    await renderPage();
    const before = formValues();
    choose(UNKNOWN_SUPPLIER);
    expect((await screen.findByRole("alert")).textContent).toContain("We can't read this invoice's layout yet. The form was left as it was");
    expect(formValues()).toEqual(before);

    choose(EDP_SIMPLE);
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Read from the invoice (EDP):")).toBeNull();
    expect(formValues()).toEqual(before);
  });

  it("explains a password, a scan, a broken file and a file too large, without changing the form", async () => {
    await renderPage();
    const before = formValues();
    const cases: [string[] | Error, RegExp][] = [
      [new InvoicePdfError("encrypted"), /password-protected/],
      [new InvoicePdfError("noText"), /no text to read/],
      [new Error("boom"), /could not be read as a PDF/],
    ];
    for (const [outcome, message] of cases) {
      choose(outcome);
      expect((await screen.findByRole("alert")).textContent).toMatch(message);
    }
    choose([], "big.pdf", 16 * 1024 * 1024);
    expect((await screen.findByRole("alert")).textContent).toMatch(/larger than 15 MB/);
    expect(pdfLines).toHaveBeenCalledTimes(3);
    expect(formValues()).toEqual(before);
  });
});
