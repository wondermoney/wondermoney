// GET /api/solar-production: a typical year of PV production for any tilt, orientation and location
// in Portugal, from PVGIS. The contract is in lib/calculators/solarProductionQuery.ts and the
// handler in lib/calculators/solarProductionApi.ts.
import type { APIRoute } from "astro";
import { createSolarProductionHandler } from "@/lib/calculators/solarProductionApi";

export const prerender = false;

const handle = createSolarProductionHandler();

export const GET: APIRoute = ({ request }) => handle(request);
/** Any other method: 405 (the handler answers it). */
export const ALL: APIRoute = ({ request }) => handle(request);
