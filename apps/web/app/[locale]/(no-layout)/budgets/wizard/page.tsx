"use client";

import { redirect } from "next/navigation";

export default function BudgetCreatePage() {
  redirect("/budgets/wizard/household");
}
