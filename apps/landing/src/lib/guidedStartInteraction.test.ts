// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { LITERACY_QUESTIONS } from "./guidedStart";
import { activateGuidedStart } from "./guidedStartInteraction";
import { pushGtmEvent } from "./gtm";

vi.mock("./gtm", () => ({ pushGtmEvent: vi.fn(), getPageType: () => "where-to-start" }));

function setup() {
  document.body.innerHTML = `
    <form data-guided-discovery hidden>
      <input type="radio" required name="goal" value="savings">
      <input type="radio" required name="task" value="review">
      <input type="radio" required name="task" value="plan">
      <button>Find</button>
      <section data-guided-result hidden>
        <h2 tabindex="-1">Result</h2>
        <div data-guided-destination="toolSavingsRate" hidden></div>
        <div data-guided-destination="toolSavingsGoal" hidden>
          <a href="/en/tools/savings-goal-calculator" data-guided-link="result" data-route-id="toolSavingsGoal">Tool</a>
        </div>
      </section>
    </form>
    <div data-literacy-quiz hidden>
      <form data-literacy-form>
        ${LITERACY_QUESTIONS.map(({ id }) => `
          <fieldset>
            <input type="radio" required name="${id}" value="0">
          </fieldset>
        `).join("")}
        <button type="submit">Check</button>
        <section data-literacy-result hidden>
          <h3 tabindex="-1"><span data-literacy-score="2" hidden>Score</span></h3>
          ${LITERACY_QUESTIONS.map(({ id }) => `
            <div data-literacy-feedback="${id}">
              <p data-literacy-correct hidden></p>
              <p data-literacy-incorrect hidden></p>
            </div>
          `).join("")}
          <button type="reset">Retry</button>
        </section>
      </form>
    </div>
  `;
  activateGuidedStart(document.body);
  return userEvent.setup();
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing test element: ${selector}`);
  return match;
}

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  // Each test gets a new root so the delegated listeners are removed with it.
  document.body = document.createElement("body");
});

describe("guided start interaction", () => {
  it("reveals the matching native link and tracks its activation without answers", async () => {
    const user = setup();
    await user.click(element('[name="goal"]'));
    await user.click(element('[value="plan"]'));
    await user.click(element("[data-guided-discovery] button"));
    expect(document.activeElement).toBe(element("[data-guided-result] h2"));
    expect(element('[data-guided-destination="toolSavingsGoal"]').hidden).toBe(false);
    expect(element('[data-guided-destination="toolSavingsRate"]').hidden).toBe(true);
    expect(pushGtmEvent).not.toHaveBeenCalled();
    const link = element<HTMLAnchorElement>("[data-guided-link]");
    expect(link.getAttribute("href")).toBe("/en/tools/savings-goal-calculator");
    // Keep jsdom on the same document while checking that the page itself permits navigation.
    document.body.addEventListener("click", (event) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    }, { once: true });
    await user.click(link);
    expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
      event: "guided_start_link_click",
      destination: "toolSavingsGoal",
      placement: "result",
      page_type: "where-to-start",
    });
    await user.click(element('[value="review"]'));
    expect(element("[data-guided-result]").hidden).toBe(true);
  });

  it("requires every answer, reveals feedback, and clears the attempt on retry", async () => {
    const user = setup();
    const submit = element("[data-literacy-form] button[type=submit]");
    await user.click(submit);
    expect(element("[data-literacy-result]").hidden).toBe(true);
    expect(pushGtmEvent).not.toHaveBeenCalled();
    for (const { id } of LITERACY_QUESTIONS) await user.click(element(`[name="${id}"]`));
    await user.click(submit);

    expect(element("[data-literacy-score]").hidden).toBe(false);
    expect(element('[data-literacy-feedback="budget"] [data-literacy-correct]').hidden).toBe(false);
    expect(element('[data-literacy-feedback="fees"] [data-literacy-incorrect]').hidden).toBe(false);
    expect(document.activeElement).toBe(element("[data-literacy-result] h3"));
    expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
      event: "literacy_quiz_complete",
      page_type: "where-to-start",
    });

    await user.click(element("[data-literacy-form] button[type=reset]"));
    expect(element("[data-literacy-result]").hidden).toBe(true);
    const firstChoice = element<HTMLInputElement>('[name="budget"]');
    expect(firstChoice.checked).toBe(false);
    expect(firstChoice.disabled).toBe(false);
    expect(document.activeElement).toBe(firstChoice);
  });
});
