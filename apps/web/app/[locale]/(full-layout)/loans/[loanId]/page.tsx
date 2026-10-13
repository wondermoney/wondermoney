import LoanDetailClient from "./loan-detail-client";

type PageProps = {
  params: Promise<{ loanId: string }>;
};

export default async function LoanDetailPage({ params }: PageProps) {
  const { loanId } = await params;

  return <LoanDetailClient loanId={loanId} />;
}
