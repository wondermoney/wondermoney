import { pushGtmEvent } from "./gtm";

export function trackResourcesHubClicks(root: HTMLElement): void {
  const track = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>(
      "a[data-resource-destination]",
    );
    const destination = link?.dataset.resourceDestination;

    if (destination) {
      pushGtmEvent({
        event: "resources_hub_click",
        destination,
        page_type: "resources",
      });
    }
  };

  root.addEventListener("click", track);
  root.addEventListener("auxclick", (event) => {
    if (event.button === 1) track(event);
  });
}
