"use client";

import {
  type AutocompleteSource,
  type AutocompleteState,
  createAutocomplete,
} from "@algolia/autocomplete-core";
import type { Hit } from "@algolia/client-search";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { getTickerSearch } from "@/lib/api/financial-markets/useTickerSearch";

function debouncePromise(fn: (...args: unknown[]) => unknown, time: number) {
  let timerId: ReturnType<typeof setTimeout> | undefined = undefined;
  return function debounced(...args: unknown[]) {
    if (timerId) {
      clearTimeout(timerId);
    }
    return new Promise((resolve) => {
      timerId = setTimeout(() => resolve(fn(...args)), time);
    });
  };
}

// Debounce the actual search request (not just the source list) so a burst of
// keystrokes issues a single API call instead of one per character.
const debouncedSearch = debouncePromise(
  (query: unknown) => getTickerSearch(String(query)),
  200,
);

export type TickerAutocompleteItem = {
  currency: string;
  exchange: string;
  name: string;
  symbol: string;
};

export type TickerAutocompleteHit = Hit<TickerAutocompleteItem>;

// The search response has no per-listing unique ID (no ISIN/MIC) — a symbol
// alone is not unique because the same ticker (e.g. "MSFT") can appear once
// per exchange it's listed on. Compose symbol + exchange for a React `key`
// that's unique per result row instead of colliding across listings.
export function getTickerAutocompleteItemKey(
  item: TickerAutocompleteItem,
): string {
  return `${item.symbol}::${item.exchange}`;
}

interface UseTickerAutocompleteOptions {
  selectedTicker?: string | null;
  onTickerSelected: (ticker: string) => void;
}

/**
 * Shared Algolia-autocomplete-core wiring for both TickerAutoComplete
 * (compact, used in portfolio modals) and TickerExplorerAutoComplete (rich,
 * used in the market Explorer). Each component keeps its own item/panel
 * rendering — only the search/open/close/touch plumbing is shared here.
 */
export function useTickerAutocomplete({
  selectedTicker,
  onTickerSelected,
}: UseTickerAutocompleteOptions) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement>(null);
  // autocomplete-core's getInputProps/getFormProps take the input element
  // while rendering, so it is mirrored into state rather than read off the ref.
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(
    null,
  );
  const attachInput = useCallback((element: HTMLInputElement | null) => {
    inputRef.current = element;
    setInputElement(element);
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const environmentRef = useRef<HTMLElement>(null);
  // Keep the latest selection callback in a ref so the autocomplete instance
  // (memoized on `t` only) can call it from `onSelect` without being recreated.
  const onSelectedRef = useRef(onTickerSelected);
  useEffect(() => {
    onSelectedRef.current = onTickerSelected;
  }, [onTickerSelected]);
  const [autocompleteState, setAutocompleteState] =
    useState<AutocompleteState<TickerAutocompleteHit>>();
  // Without an explicit id, autocomplete-core names its elements from a
  // module-level counter. The server's counter keeps climbing across requests
  // while the browser's starts at 0, so the input's id and aria attributes
  // never matched on hydration. React's useId is the same on both sides.
  const autocompleteId = useId();

  const autocomplete = useMemo(
    () =>
      createAutocomplete<
        TickerAutocompleteHit,
        React.BaseSyntheticEvent,
        React.MouseEvent,
        React.KeyboardEvent
      >({
        id: autocompleteId,
        placeholder: t("explorer-search-placeholder"),
        debug: false,
        openOnFocus: true,
        onStateChange({ state }) {
          setAutocompleteState(state);
        },
        getSources({ query }) {
          return [
            {
              sourceId: "tickers",
              getItems() {
                // `openOnFocus` triggers this with an empty query as soon as
                // the input is focused (before the user types anything). The
                // API rejects an empty/whitespace-only searchTerm with a 400,
                // so skip the request entirely in that case.
                const trimmedQuery = query.trim();
                if (!trimmedQuery) {
                  return Promise.resolve([]);
                }
                return debouncedSearch(trimmedQuery) as Promise<
                  TickerAutocompleteHit[]
                >;
              },
              // Selecting an option with the keyboard (ArrowDown + Enter) goes
              // through the source's onSelect. Without it, only mouse clicks
              // select a ticker and Enter silently does nothing.
              onSelect({ item, setQuery, setIsOpen }) {
                setQuery(item.symbol);
                setIsOpen(false);
                onSelectedRef.current(item.symbol);
              },
            },
          ] as AutocompleteSource<TickerAutocompleteHit>[];
        },
      }),
    [autocompleteId, t],
  );

  const onItemClick = (ticker: string) => {
    autocomplete.setQuery(ticker);
    autocomplete.setIsOpen(false);
    onTickerSelected(ticker);
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      autocomplete.setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [autocomplete]);

  const { getEnvironmentProps } = autocomplete;
  useEffect(() => {
    if (!environmentRef.current || !panelRef.current || !inputRef.current) {
      return undefined;
    }

    const { onTouchStart, onTouchMove } = getEnvironmentProps({
      formElement: environmentRef.current,
      inputElement: inputRef.current,
      panelElement: panelRef.current,
    });

    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [getEnvironmentProps]);

  useEffect(() => {
    if (selectedTicker) {
      autocomplete.setQuery(selectedTicker);
    }
  }, [autocomplete, selectedTicker]);

  return {
    autocomplete,
    autocompleteState,
    inputElement,
    attachInput,
    panelRef,
    environmentRef,
    onItemClick,
  };
}
