"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { forwardRef, type InputHTMLAttributes, useState } from "react";

import {
  getTickerAutocompleteItemKey,
  useTickerAutocomplete,
} from "@/lib/hooks/use-ticker-autocomplete";
import { cn } from "@/lib/utils";
import { getFinancialAssetLogo } from "@/lib/utils/financialAssetLogo";

import { Input } from "./input";
import { Text } from "./Typography";

type AutocompleteItem = {
  currency: string;
  exchange: string;
  name: string;
  symbol: string;
};

interface ItemProps {
  hit: AutocompleteItem;
  onTickerSelected: (ticker: string) => void;
  variant?: "default" | "compact";
}

interface PanelProps {
  children: React.ReactNode;
}

const Panel = forwardRef<HTMLDivElement, PanelProps>(({ children }, ref) => {
  return (
    <div
      className={cn(
        "bg-popover text-popover-foreground absolute z-50 mt-1 max-h-96 min-w-[8rem] overflow-hidden rounded-md border shadow-md",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "w-full",
      )}
      ref={ref}
    >
      <div className="p-1">{children}</div>
    </div>
  );
});
Panel.displayName = "Panel";

const Item: React.FC<ItemProps> = ({ hit, onTickerSelected }) => {
  const [ticketImgSrc, setTicketImgSrc] = useState(
    getFinancialAssetLogo(hit.symbol),
  );
  return (
    <div
      className={cn(
        "focus-visible:bg-accent focus-visible:text-accent-foreground hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none",
      )}
      onClick={() => onTickerSelected(hit.symbol)}
    >
      <div className="flex shrink-0 items-center gap-2">
        <Image
          src={ticketImgSrc}
          height={16}
          width={16}
          alt=""
          className="rounded"
          onError={() => setTicketImgSrc("/chart-candlestick.svg")}
        />
        <Text variant="smallText" className="text-xs font-medium">
          {hit.symbol}
        </Text>
        <Text
          variant="smallText"
          className="text-muted-foreground truncate text-xs capitalize"
        >
          {hit.name.toLocaleLowerCase()}
        </Text>
      </div>
    </div>
  );
};

interface AutoCompleteProps {
  onTickerSelected: (ticker: string) => void;
  selectedTicker?: string | null;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  variant?: "default" | "compact";
}

const TickerAutoComplete: React.FC<AutoCompleteProps> = ({
  onTickerSelected,
  selectedTicker,
  inputProps,
  variant = "default",
}) => {
  const t = useTranslations();
  const { autocomplete, autocompleteState, inputElement, attachInput, panelRef, environmentRef, onItemClick } =
    useTickerAutocomplete({ selectedTicker, onTickerSelected });

  const showNoResults =
    (autocompleteState?.query?.trim().length ?? 0) > 0 &&
    autocompleteState?.status === "idle" &&
    (autocompleteState?.collections ?? []).every(({ items }) => items.length === 0);

  return (
    <div className="relative" {...autocomplete.getRootProps({})}>
      <div
        className="flex"
        ref={environmentRef as React.RefObject<HTMLDivElement>}
        role="search"
      >
        <div className="relative w-full">
          <Input
            ref={attachInput}
            {...autocomplete.getInputProps({ inputElement })}
            {...inputProps}
            className={cn(
              "border-input bg-background ring-offset-background text-muted-foreground focus:ring-ring flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
              inputProps?.className,
            )}
          />
        </div>
      </div>
      {autocompleteState?.isOpen && (
        <Panel ref={panelRef} {...autocomplete.getPanelProps({})}>
          {showNoResults && (
            <Text
              role="status"
              aria-live="polite"
              variant="smallText"
              className="text-muted-foreground px-2 py-1.5"
            >
              {t("financial-markets-explorer-no-results")}
            </Text>
          )}
          {autocompleteState?.collections.map((collection, index) => {
            const { source, items } = collection;
            return (
              <div key={`source-${index}`}>
                {items.length > 0 && (
                  <div
                    {...autocomplete.getListProps()}
                    className="overflow-auto"
                  >
                    {items.map((item) => (
                      <Item
                        key={getTickerAutocompleteItemKey(item)}
                        hit={item}
                        onTickerSelected={onItemClick}
                        variant={variant}
                        {...autocomplete.getItemProps({ item, source })}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
};

export default TickerAutoComplete;
