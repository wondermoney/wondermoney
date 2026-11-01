/**
 * Global Cypress setup, loaded before every spec.
 *
 * ResizeObserver loop notifications: when a ResizeObserver callback changes
 * layout, the browser defers the remaining observations to the next frame and
 * reports "ResizeObserver loop completed with undelivered notifications" as a
 * window `error` event. Nothing is thrown and no observation is lost; the spec
 * (https://drafts.csswg.org/resize-observer/#deliver-resize-error) uses the
 * event only to flag the deferral. Radix's popper-positioned Select (floating-ui
 * `autoUpdate` + its scroll buttons) produces it when the list opens, which
 * Cypress would otherwise turn into a test failure.
 *
 * Only these exact messages are ignored; every other application error still
 * fails the test.
 */
const RESIZE_OBSERVER_LOOP_MESSAGES = [
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
];

Cypress.on("uncaught:exception", (error) => {
  if (RESIZE_OBSERVER_LOOP_MESSAGES.some((message) => error.message.includes(message))) {
    return false;
  }
  return undefined;
});
