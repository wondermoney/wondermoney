import { notFound } from "next/navigation";

import { ExpenseGroupDetail } from "@/components/expense-group/ExpenseGroupDetail";

type PageProps = {
  params: Promise<{ groupId: string }>;
};

export default async function GroupDetailPage({ params }: PageProps) {
  const { groupId } = await params;
  const id = Number(groupId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  return <ExpenseGroupDetail groupId={id} />;
}
