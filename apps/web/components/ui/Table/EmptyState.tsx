"use client";

import { useTranslations } from "next-intl";

import { Text } from "../Typography";

interface TableEmptyStateProps {
  text?: string;
}

const TableEmptyState: React.FC<TableEmptyStateProps> = ({ text }) => {
  const t = useTranslations();
  return (
    <div className="bg-muted flex h-36 w-full items-center justify-center">
      <Text variant="mutedText">{text ?? t("table-empty-state")}</Text>
    </div>
  );
};

export default TableEmptyState;
