"use client";

import { Text } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";
interface TableCellDefaultProps {
  value: any;
  className?: string;
}

const TableCellDefault: React.FC<TableCellDefaultProps> = ({
  value,
  className,
}) => {
  return (
    <Text variant="smallText" className={cn("whitespace-nowrap", className)}>
      {value}
    </Text>
  );
};

export default TableCellDefault;
