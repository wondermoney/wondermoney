import { merge } from "lodash-es";
import type { Metadata } from "next";

import { getBaseUrl } from "./url";

type MetadataGenerator = Omit<Metadata, "description" | "title"> & {
  title: string;
  description: string;
  image?: string;
};

const applicationName = "WonderMoney";
const author: Metadata["authors"] = {
  name: "RadixCatch",
  url: getBaseUrl(),
};
const publisher = "RadixCatch";
const twitterHandle = "@wondermoneyapp";

function resolveMetadataBaseUrl(baseUrl: string): URL {
  return new URL(/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
}

export const createMetadata = ({
  title,
  description,
  image,
  ...properties
}: MetadataGenerator): Metadata => {
  const parsedTitle = `${title} | ${applicationName}`;
  const defaultMetadata: Metadata = {
    metadataBase: resolveMetadataBaseUrl(getBaseUrl()),
    title: parsedTitle,
    description,
    applicationName,
    authors: [author],
    creator: author.name,
    formatDetection: { telephone: false },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: parsedTitle,
    },
    openGraph: {
      title: parsedTitle,
      description,
      type: "website",
      siteName: applicationName,
      locale: "en_US",
    },
    publisher,
    twitter: { card: "summary_large_image", creator: twitterHandle },
  };

  const metadata: Metadata = merge(defaultMetadata, properties);

  if (image && metadata.openGraph) {
    metadata.openGraph.images = [
      { url: image, width: 1200, height: 630, alt: title },
    ];
  }

  return metadata;
};
