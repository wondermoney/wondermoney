import { notFound } from "next/navigation";

import GoalDetailClient from "./goal-detail-client";

interface GoalPageProps {
  params: Promise<{ goalKey: string }>;
}

export default async function GoalPage({ params }: GoalPageProps) {
  const { goalKey: goalKeyParam } = await params;
  const goalKey = Number(goalKeyParam);

  if (!Number.isInteger(goalKey) || goalKey <= 0) {
    notFound();
  }

  return <GoalDetailClient goalKey={goalKey} />;
}
