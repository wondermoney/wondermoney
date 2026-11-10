import AssetDetailClient from "./asset-detail-client";

type PageProps = {
  params: Promise<{ assetId: string }>;
};

export default async function AssetDetailPage({ params }: PageProps) {
  const { assetId } = await params;

  return <AssetDetailClient assetId={assetId} />;
}
