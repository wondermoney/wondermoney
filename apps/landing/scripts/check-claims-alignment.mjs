import assert from "node:assert/strict";
import { scanClaims } from "./claims-alignment.mjs";

const matches = scanClaims();
const claims = matches.filter(({ classification }) => classification === "claim");
assert.deepEqual(claims, [], claims.map((match) => `${match.file}: ${match.rule}: ${match.text}`).join("\n"));

const counts = Object.groupBy(matches, ({ classification }) => classification);
console.log(`Claims alignment passed. Remaining classified matches: technical=${counts.technical?.length ?? 0}, historical=${counts.historical?.length ?? 0}, not-claim=${counts["not-claim"]?.length ?? 0}.`);
