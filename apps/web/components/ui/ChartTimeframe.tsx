import { Button } from "@/components/ui/button";

export interface ChartTimeframeT {
  label: string;
  valueInDays: number | null;
}

interface ChartTimeframeProps {
  timeframes: ChartTimeframeT[];
  activeTimeframe: ChartTimeframeT;
  onTimeframeChange: (timeframe: ChartTimeframeT) => void;
  compact?: boolean;
}

const ChartTimeframe: React.FC<ChartTimeframeProps> = ({
  timeframes,
  activeTimeframe,
  onTimeframeChange,
  compact = false,
}) => {
  return (
    <div className={compact ? "flex flex-wrap justify-start gap-1" : "mr-8 flex justify-end gap-1"}>
      {timeframes.map((timeframe) => (
        <Button
          size="xs"
          key={timeframe.label}
          variant={
            timeframe.label === activeTimeframe.label ? "default" : "outline"
          }
          onClick={() => onTimeframeChange(timeframe)}
          className={compact ? "h-6 w-8 rounded-sm text-xs" : "h-6 w-8 rounded-sm text-xs"}
        >
          {timeframe.label}
        </Button>
      ))}
    </div>
  );
};

export default ChartTimeframe;
