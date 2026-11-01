
export function createPortfolioImportHandoff(
  setAddTransactionOpen: (open: boolean) => void,
  setImportTransactionOpen: (open: boolean) => void,
) {
  return () => {
    setAddTransactionOpen(false);
    setImportTransactionOpen(true);
  };
}

export function getPortfolioImportTransactionsHref(portfolioId: string) {
  return `/portfolio/${portfolioId}/transactions?import=1`;
}

export function shouldOpenPendingPortfolioImport({
  isAddTransactionOpen,
  pendingImportOpen,
}: {
  isAddTransactionOpen: boolean;
  pendingImportOpen: boolean;
}) {
  return pendingImportOpen && !isAddTransactionOpen;
}
