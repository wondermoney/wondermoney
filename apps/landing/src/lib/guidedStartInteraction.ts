import { getPageType, pushGtmEvent } from "./gtm";
import {
  GUIDED_GOALS,
  GUIDED_TASKS,
  LITERACY_CHOICES,
  LITERACY_QUESTIONS,
  getGuidedDestination,
  scoreLiteracyQuiz,
  type LiteracyAnswers,
} from "./guidedStart";

export function activateGuidedStart(page: HTMLElement): void {
  const trackLink = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[data-guided-link]");
    if (!link) return;
    pushGtmEvent({
      event: "guided_start_link_click",
      destination: link.dataset.routeId,
      placement: link.dataset.guidedLink,
      page_type: getPageType(),
    });
  };
  page.addEventListener("click", trackLink);
  page.addEventListener("auxclick", (event) => {
    if (event.button === 1) trackLink(event);
  });

  const discovery = page.querySelector<HTMLFormElement>("[data-guided-discovery]");
  const recommendation = discovery?.querySelector<HTMLElement>("[data-guided-result]");
  if (discovery && recommendation) {
    const results = recommendation.querySelectorAll<HTMLElement>("[data-guided-destination]");
    discovery.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(discovery);
      const goal = GUIDED_GOALS.find((value) => value === data.get("goal"));
      const task = GUIDED_TASKS.find((value) => value === data.get("task"));
      if (!goal || !task) return;

      const destination = getGuidedDestination(goal, task);
      for (const result of results) result.hidden = result.dataset.guidedDestination !== destination;
      recommendation.hidden = false;
      recommendation.querySelector("h2")?.focus();
    });
    discovery.addEventListener("change", () => { recommendation.hidden = true; });
    discovery.hidden = false;
  }

  const quiz = page.querySelector<HTMLElement>("[data-literacy-quiz]");
  const form = quiz?.querySelector<HTMLFormElement>("[data-literacy-form]");
  const review = form?.querySelector<HTMLElement>("[data-literacy-result]");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!quiz || !form || !review || !submit) return;

  const scores = review.querySelectorAll<HTMLElement>("[data-literacy-score]");
  const feedback = review.querySelectorAll<HTMLElement>("[data-literacy-feedback]");
  const questions = form.querySelectorAll("fieldset");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    const data = new FormData(form);
    const answers: LiteracyAnswers = {};
    for (const { id } of LITERACY_QUESTIONS) {
      answers[id] = LITERACY_CHOICES.find((choice) => String(choice) === data.get(id));
    }
    const score = scoreLiteracyQuiz(answers);
    if (score === undefined) return;

    for (const item of scores) item.hidden = item.dataset.literacyScore !== String(score);
    for (const { id, correct } of LITERACY_QUESTIONS) {
      const item = Array.from(feedback).find((row) => row.dataset.literacyFeedback === id);
      item?.querySelector("[data-literacy-correct]")?.toggleAttribute("hidden", answers[id] !== correct);
      item?.querySelector("[data-literacy-incorrect]")?.toggleAttribute("hidden", answers[id] === correct);
    }
    for (const fieldset of questions) fieldset.disabled = true;
    submit.disabled = true;
    review.hidden = false;
    review.querySelector("h3")?.focus();
    pushGtmEvent({ event: "literacy_quiz_complete", page_type: getPageType() });
  });
  form.addEventListener("reset", () => {
    review.hidden = true;
    submit.disabled = false;
    for (const fieldset of questions) fieldset.disabled = false;
    form.querySelector("input")?.focus();
  });
  quiz.hidden = false;
}
