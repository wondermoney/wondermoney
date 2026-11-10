export type GoalsView = "active" | "archived";

/**
 * The goals a tab lists. The active tab used to list every goal, archived
 * ones included, and counted them in its summary figures.
 */
export function goalsForView<T extends { status: string }>(
  goals: T[],
  view: GoalsView,
): T[] {
  return view === "archived"
    ? goals.filter((goal) => goal.status === "archived")
    : goals.filter((goal) => goal.status !== "archived");
}
