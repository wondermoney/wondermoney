export interface AllocationPreset {
  key: "conservative" | "balanced" | "growth";
  targets: Record<string, number>;
}

export const ALLOCATION_PRESETS: AllocationPreset[] = [
  {
    key: "conservative",
    targets: { Equities: 30, "Fixed Income": 60, "Cash & Equivalents": 10 },
  },
  {
    key: "balanced",
    targets: { Equities: 60, "Fixed Income": 30, "Cash & Equivalents": 10 },
  },
  {
    key: "growth",
    targets: { Equities: 80, "Fixed Income": 15, "Cash & Equivalents": 5 },
  },
];
