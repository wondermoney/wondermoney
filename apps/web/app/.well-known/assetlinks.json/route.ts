import {
  androidAssetLinks,
  wellKnownResponse,
} from "@/lib/mobile-app/associated-apps";

// Read the environment on each request: the Docker image is built once for every instance.
export const dynamic = "force-dynamic";

/** Lets the Android app use this web app's passkeys (lib/mobile-app/associated-apps.ts). */
export function GET() {
  return wellKnownResponse(androidAssetLinks(process.env));
}
