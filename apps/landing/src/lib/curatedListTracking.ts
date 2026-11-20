import { readConsentDecision, subscribeToConsent } from "./consent";
import { getPageType, pushGtmEvent } from "./gtm";

/**
 * A curated list page's analytics: `curated_list_viewed` once per page view, and
 * `curated_list_entry_click` for each entry followed. Both carry only the list's id (the
 * `data-curated-list` of `root`) and, for a click, the entry's format and its public address
 * (https, no query string: `curatedLists.test.ts`), never anything about the visitor. Like
 * every event on this site they are sent only with analytics consent (`pushGtmEvent`); a view
 * whose consent is given after the page loaded is counted then.
 */
export function trackCuratedListPage(root: HTMLElement): void {
  const list = root.dataset.curatedList;
  if (!list) return;

  let viewed = false;
  const view = () => {
    if (viewed || !readConsentDecision(window.localStorage).purposes.analytics) return;
    viewed = true;
    pushGtmEvent({ event: "curated_list_viewed", list, page_type: getPageType() });
  };
  view();
  if (!viewed) {
    const stop = subscribeToConsent(window, () => {
      view();
      if (viewed) stop();
    });
  }

  const track = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>(
      "a[data-curated-entry-link]",
    );
    if (!link) return;
    pushGtmEvent({
      event: "curated_list_entry_click",
      list,
      format: link.dataset.curatedEntryLink,
      destination: link.href,
      page_type: getPageType(),
    });
  };
  root.addEventListener("click", track);
  root.addEventListener("auxclick", (event) => {
    if (event.button === 1) track(event);
  });
}
