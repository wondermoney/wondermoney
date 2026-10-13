"use client";

import AutoComplete from "@/components/ui/TickerExplorerAutoComplete";

interface FinancialMarketsExplorerSearchProps {
  onTickerSelected: (ticker: string) => void;
  selectedTicker?: string | null;
}

const FinancialMarketsExplorerSearch = ({
  onTickerSelected,
  selectedTicker,
}: FinancialMarketsExplorerSearchProps) => {
  return (
    <AutoComplete
      onTickerSelected={onTickerSelected}
      selectedTicker={selectedTicker}
    />
  );
};

export default FinancialMarketsExplorerSearch;
