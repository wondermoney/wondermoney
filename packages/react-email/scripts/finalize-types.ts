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
// dist/index.d.ts re-exports types + the copy source from ./lifecycle-copy.js,
// so its declaration must ship alongside index.d.ts.
await copyFile(
  resolve(root, ".types/src/lifecycle-copy.d.ts"),
  resolve(root, "dist/lifecycle-copy.d.ts"),
);
// dist/index.d.ts also re-exports LifecycleDynamicData from ./lifecycle-dynamic.js.
await copyFile(
  resolve(root, ".types/src/lifecycle-dynamic.d.ts"),
  resolve(root, "dist/lifecycle-dynamic.d.ts"),
);
await rm(resolve(root, ".types"), { recursive: true, force: true });
