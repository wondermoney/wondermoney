import { merge } from "lodash-es";
import type { Metadata } from "next";

import { isDefaultInstanceName } from "@/lib/instance-name";
import { getInstanceName } from "@/lib/instance-name.server";

import { getBaseUrl } from "./url";

type MetadataGenerator = Omit<Metadata, "description" | "title"> & {
  title: string;
  description: string;
  image?: string;
};

/** The hosted service's publisher and social account; a renamed instance is not theirs. */
const hostedPublisher = "RadixCatch";
const hostedTwitterHandle = "@wondermoneyapp";

function resolveMetadataBaseUrl(baseUrl: string): URL {
  return new URL(/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
}

/**
 * Page metadata for an instance called `instanceName`: the tab title is "<page> | <instance>",
 * and the instance names the app for bookmarks, home-screen installs and link previews.
 */
export const buildMetadata = ({
  title,
  description,
  image,
  instanceName,
  ...properties
}: MetadataGenerator & { instanceName: string }): Metadata => {
  const applicationName = instanceName;
  const parsedTitle = `${title} | ${applicationName}`;
  const hosted = isDefaultInstanceName(instanceName);
  const defaultMetadata: Metadata = {
    metadataBase: resolveMetadataBaseUrl(getBaseUrl()),
    title: parsedTitle,
    description,
    applicationName,
    ...(hosted && {
      authors: [{ name: hostedPublisher, url: getBaseUrl() }],
      creator: hostedPublisher,
      publisher: hostedPublisher,
    }),
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
    twitter: {
      card: "summary_large_image",
      ...(hosted && { creator: hostedTwitterHandle }),
    },
  };

  const metadata: Metadata = merge(defaultMetadata, properties);

  if (image && metadata.openGraph) {
    metadata.openGraph.images = [
      { url: image, width: 1200, height: 630, alt: title },
    ];
  }

  return metadata;
};

/** {@link buildMetadata} for this instance, its name read from the API. */
export const createMetadata = async (
  properties: MetadataGenerator,
): Promise<Metadata> =>
  buildMetadata({ ...properties, instanceName: await getInstanceName() });
