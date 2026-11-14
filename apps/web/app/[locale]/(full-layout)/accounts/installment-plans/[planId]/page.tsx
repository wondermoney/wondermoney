import InstallmentPlanClient from "./installment-plan-client";

type PageProps = {
  params: Promise<{ planId: string }>;
};

export default async function InstallmentPlanPage({ params }: PageProps) {
  const { planId } = await params;

  return <InstallmentPlanClient planId={planId} />;
}
