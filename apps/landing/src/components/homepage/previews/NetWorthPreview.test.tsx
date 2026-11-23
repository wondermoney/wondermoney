// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

import NetWorthPreview from "./NetWorthPreview";
import { FEATURE_NET_WORTH, HERO_NET_WORTH, type NetWorthSample } from "./netWorthSample";

afterEach(cleanup);

const renderIn = (locale: Lang, sample: NetWorthSample) =>
	render(
		<ReactTranslationsProvider locale={locale}>
			<NetWorthPreview sample={sample} />
		</ReactTranslationsProvider>,
	);

// Intl puts a no-break space (or a narrow one) before the percent sign and the euro sign.
const text = (element: Element | null) => element?.textContent?.replace(/[\u00a0\u202f]/g, " ");
const classesOf = (element: Element | null) => (element?.className ?? "").split(/\s+/);

describe("NetWorthPreview", () => {
	it("shows the period's change beside net worth in the locale's format, as a gain", () => {
		// Given the hero's household in Portuguese
		renderIn("pt", HERO_NET_WORTH);

		// When
		const badge = screen.getByText((_, el) => el?.tagName === "SPAN" && text(el) === "+7,3%");

		// Then the badge carries the sign and the success tokens, never a stock palette class
		expect(classesOf(badge)).toEqual(expect.arrayContaining(["text-success-text", "bg-success/10"]));
		expect(screen.getByText((_, el) => el?.tagName === "SPAN" && text(el) === "+3650 €")).toBeTruthy();
		expect(screen.getByText((_, el) => el?.tagName === "P" && text(el) === "53 630 €")).toBeTruthy();
	});

	it("formats the change for English with the euro first", () => {
		renderIn("en", HERO_NET_WORTH);

		expect(screen.getByText((_, el) => el?.tagName === "SPAN" && text(el) === "+7.3%")).toBeTruthy();
		expect(screen.getByText((_, el) => el?.tagName === "SPAN" && text(el) === "+€3,650")).toBeTruthy();
	});

	it("shows a debt that grew as a loss and a debt paid down as a gain, keeping the sign", () => {
		// Given the feature page's household: the card balance rose, the mortgage fell
		renderIn("pt", FEATURE_NET_WORTH);

		// When
		const card = screen.getByText((_, el) => el?.tagName === "SPAN" && text(el) === "+13,9%");
		const mortgage = screen.getByText((_, el) => el?.tagName === "SPAN" && text(el) === "-3,0%");

		// Then
		expect(classesOf(card)).toContain("text-destructive-text");
		expect(classesOf(mortgage)).toContain("text-success-text");
	});

	it("highlights the latest point only and names the trend for screen readers", () => {
		// Given
		const { container } = renderIn("en", HERO_NET_WORTH);

		// Then one marker, at the chart's right edge, and no dot per month
		const markers = screen.getAllByTestId("net-worth-latest-point");
		expect(markers).toHaveLength(1);
		expect((markers[0] as HTMLElement).style.left).toBe("100%");
		expect(container.querySelectorAll("circle")).toHaveLength(0);
		expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/^Net worth, Mar to Aug, rising from €49,980 to €53,630$/);
	});

	it("puts an example institution's logo beside every account row, its label still the text", () => {
		// Given the feature page's household, five accounts
		const { container } = renderIn("pt", FEATURE_NET_WORTH);

		// Then one decorative logo per row, and the labels stay visible text
		const logos = container.querySelectorAll("li img");
		expect(logos).toHaveLength(FEATURE_NET_WORTH.rows.length);
		for (const logo of logos) expect(logo.getAttribute("alt")).toBe("");
		expect(screen.getByText("Hipoteca")).toBeTruthy();
	});
});
