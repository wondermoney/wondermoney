"use client";

import { useTranslations } from "next-intl";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";

import {
  getTickerAutocompleteItemKey,
  useTickerAutocomplete,
} from "@/lib/hooks/use-ticker-autocomplete";
import { cn } from "@/lib/utils";

import getExchangeFlag, { Exchanges } from "../../lib/utils/getExchangeFlag";
import { Button } from "./button";
import { Input } from "./input";
import { Separator } from "./separator";
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

type ButtonProps = ComponentPropsWithoutRef<typeof Button>;
type ForwardedButtonProps = Omit<ButtonProps, "variant">;

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        className={cn(
          "bg-popover text-popover-foreground absolute z-100 mt-2 flex w-full flex-col gap-2 rounded-md border p-2 shadow-lg md:p-4",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Panel.displayName = "Panel";

const Item: React.FC<ItemProps & ForwardedButtonProps> = ({
  hit,
  onTickerSelected,
  variant = "default",
  onClick,
  className,
  ...buttonProps
}) => {
  return (
    <Button
      variant="ghost"
      {...buttonProps}
      className={cn(
        "focus-visible:bg-accent focus-visible:text-accent-foreground flex w-full items-center justify-between px-0",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onTickerSelected(hit.symbol);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Text className="font-bold">{hit.symbol}</Text>
        <Text
          className={cn(
            "text-muted-foreground max-w-32 truncate capitalize md:max-w-full",
            {
              "text-sm": variant === "compact",
              "text-md": variant !== "compact",
            },
          )}
        >
          {hit.name.toLocaleLowerCase()}
        </Text>
      </div>
      <div className="flex items-center gap-2">
        {getExchangeFlag(hit.exchange as Exchanges)}
        <Text variant="smallText">{hit.exchange}</Text>
      </div>
    </Button>
  );
};

interface AutoCompleteProps {
  onTickerSelected: (ticker: string) => void;
  selectedTicker?: string | null;
  variant?: "default" | "compact";
}

const TickerExplorerAutoComplete: React.FC<AutoCompleteProps> = ({
  onTickerSelected,
  selectedTicker,
  variant = "default",
}) => {
  const t = useTranslations();
  const { autocomplete, autocompleteState, inputElement, attachInput, panelRef, environmentRef, onItemClick } =
    useTickerAutocomplete({ selectedTicker, onTickerSelected });

  const renderSourceHeader = (sourceId: string) => {
    if (sourceId !== "tickers") {
      return null;
    }

    return (
      <div className="mb-2 flex flex-col gap-1">
        <Text variant="smallText">
          {t("financial-markets-explorer-assets-label")}
        </Text>
        <Separator />
      </div>
    );
  };

  const collections = autocompleteState?.collections ?? [];
  const showNoResults =
    (autocompleteState?.query?.trim().length ?? 0) > 0 &&
    autocompleteState?.status === "idle" &&
    collections.every(({ items }) => items.length === 0);

  return (
    <div className="relative" {...autocomplete.getRootProps({})}>
      <form
        className="flex"
        ref={environmentRef as React.RefObject<HTMLFormElement>}
        {...autocomplete.getFormProps({ inputElement })}
      >
        <Input
          ref={attachInput}
          {...autocomplete.getInputProps({ inputElement })}
          onFocus={(e) => e.currentTarget.select()}
        />
      </form>
      {autocompleteState?.isOpen && (
        <Panel ref={panelRef} {...autocomplete.getPanelProps({})}>
          {showNoResults && (
            <Text
              role="status"
              aria-live="polite"
              variant="smallText"
              className="text-muted-foreground"
            >
              {t("financial-markets-explorer-no-results")}
            </Text>
          )}
          {autocompleteState?.collections.map((collection, index) => {
            const { source, items } = collection;
            return (
              <div key={`source-${index}`}>
                {items.length > 0 && (
                  <>
                    {renderSourceHeader(source.sourceId)}
                    <div {...autocomplete.getListProps()}>
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
                  </>
                )}
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
};

export default TickerExplorerAutoComplete;
