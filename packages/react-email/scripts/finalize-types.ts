import { copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
await copyFile(
  resolve(root, ".types/src/index.d.ts"),
  resolve(root, "dist/index.d.ts"),
);
await copyFile(
  resolve(root, ".types/src/types.d.ts"),
  resolve(root, "dist/types.d.ts"),
);
await copyFile(
  resolve(root, ".types/src/weekly-insights-preheader.d.ts"),
  resolve(root, "dist/weekly-insights-preheader.d.ts"),
);
await rm(resolve(root, ".types"), { recursive: true, force: true });
