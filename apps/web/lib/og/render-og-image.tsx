import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

const COLORS = {
  accent: "#7C3AED",
  background: "#FFFFFF",
  headline: "#171717",
  label: "#8A8A8A",
} as const;

type OgImageAssets = {
  fontBold: Buffer;
  fontRegular: Buffer;
  logoDataUri: string;
};

let assetsPromise: Promise<OgImageAssets> | null = null;

function loadAssets(): Promise<OgImageAssets> {
  assetsPromise ??= (async () => {
    const fontsDir = path.join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans");
    const [fontRegular, fontBold, logoBuffer] = await Promise.all([
      readFile(path.join(fontsDir, "Geist-Regular.ttf")),
      readFile(path.join(fontsDir, "Geist-Bold.ttf")),
      readFile(path.join(process.cwd(), "public/logo.png")),
    ]);
    return {
      fontBold,
      fontRegular,
      logoDataUri: `data:image/png;base64,${logoBuffer.toString("base64")}`,
    };
  })();
  return assetsPromise;
}

export type OgImageContent = {
  accent?: string;
  eyebrow?: string;
  headline: string;
};

export async function buildOgImageResponse({ accent, eyebrow, headline }: OgImageContent) {
  const assets = await loadAssets();

  return new ImageResponse(
    (
      <div
        style={{
          backgroundColor: COLORS.background,
          display: "flex",
          flexDirection: "column",
          fontFamily: "Geist",
          height: OG_IMAGE_HEIGHT,
          justifyContent: "space-between",
          padding: 80,
          width: OG_IMAGE_WIDTH,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" height={90} src={assets.logoDataUri} width={245} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {eyebrow ? (
            <div
              style={{
                color: COLORS.label,
                fontSize: 20,
                letterSpacing: 2,
                marginBottom: 16,
                textTransform: "uppercase",
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            style={{
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              color: COLORS.headline,
              display: "-webkit-box",
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.25,
              maxWidth: 1000,
              overflow: "hidden",
            }}
          >
            {headline}
          </div>
          {accent ? (
            <div style={{ color: COLORS.accent, fontSize: 32, fontWeight: 700, marginTop: 20 }}>
              {accent}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      fonts: [
        { data: assets.fontRegular, name: "Geist", style: "normal", weight: 400 },
        { data: assets.fontBold, name: "Geist", style: "normal", weight: 700 },
      ],
      height: OG_IMAGE_HEIGHT,
      width: OG_IMAGE_WIDTH,
    },
  );
}
