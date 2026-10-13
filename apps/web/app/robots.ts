import { MetadataRoute } from "next";

import { getBaseUrl } from "@/lib/utils/url";

const host = getBaseUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/*/auth/",
          "/*/settings/",
        ],
      },
    ],
    sitemap: `${host}/sitemap.xml`,
  };
}
