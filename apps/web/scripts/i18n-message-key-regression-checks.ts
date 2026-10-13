import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

type Offense = {
  messageFile: string;
  detail: string;
};

function collectJsonFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function findDotKeys(value: unknown, filePath: string, pathSegments: string[] = []): Offense[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const offenses: Offense[] = [];

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...pathSegments, key];
    if (key.includes(".")) {
      offenses.push({ messageFile: filePath, detail: nextPath.join(".") });
    }
    offenses.push(...findDotKeys(child, filePath, nextPath));
  }

  return offenses;
}

function findDuplicateJsonKeys(content: string, filePath: string): Offense[] {
  const source = ts.parseJsonText(filePath, content);
  const root = source.statements[0]?.expression;
  const offenses: Offense[] = [];

  const visit = (node: ts.Node, pathSegments: string[]) => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.getText(source).replace(/^['"]|['"]$/g, "");
        const nextPath = [...pathSegments, key];
        if (keys.has(key)) {
          offenses.push({
            messageFile: filePath,
            detail: `duplicate key: ${nextPath.join(".")}`,
          });
        }
        keys.add(key);
        visit(property.initializer, nextPath);
      }
      return;
    }

    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element) => visit(element, pathSegments));
    }
  };

  if (root) visit(root, []);
  return offenses;
}

function getNestedValue(value: unknown, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function collectStaticLoansKeys(): string[] {
  const sourceRoots = [
    join(process.cwd(), "app", "[locale]", "(full-layout)", "loans"),
    join(process.cwd(), "components", "loan"),
  ];
  const keys = new Set<string>();

  for (const sourceFile of sourceRoots.flatMap(collectSourceFiles)) {
    const source = readFileSync(sourceFile, "utf8");
    for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
      keys.add(match[1]);
    }
  }

  return [...keys].sort();
}

function getTopLevelMessageFiles(messagesRoot: string): Record<string, string[]> {
  const locales = readdirSync(messagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const perLocale = new Map<string, string[]>();

  for (const locale of locales) {
    const localeDir = join(messagesRoot, locale);
    const files = readdirSync(localeDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    perLocale.set(locale, files);
  }

  const allTopLevelFiles = new Set<string>();
  for (const files of perLocale.values()) {
    for (const file of files) allTopLevelFiles.add(file);
  }

  const result: Record<string, string[]> = {};
  for (const file of allTopLevelFiles) {
    result[file] = locales.filter((locale) => !perLocale.get(locale)?.includes(file));
  }
  return result;
}

const messagesRoot = join(process.cwd(), "messages");
const jsonFiles = collectJsonFiles(messagesRoot).filter((filePath) => /[\\/]messages[\\/][^\\/]+[\\/]([^\\/]+)\.json$/.test(filePath));
const topLevelFileGaps = getTopLevelMessageFiles(messagesRoot);
// Two files load messages. `createNextIntlPlugin()` takes no argument, so
// next-intl uses i18n/request.ts — that is the one that actually serves every
// request, and the root i18n.ts `getRequestConfig` is dead weight kept for its
// `locales`/`defaultLocale` exports.
//
// This check used to read only i18n.ts. Renaming credits.json to loans.json
// updated that file, passed this guard, and 500'd every route in production
// because i18n/request.ts still imported the old name — a template-literal
// import, so webpack builds a context module and the miss only surfaces when a
// request renders. Both files are read now, and a file has to be imported by
// *each* of them to count.
const MESSAGE_LOADERS = ["i18n.ts", join("i18n", "request.ts")];
const loaderImports = MESSAGE_LOADERS.map((loader) => ({
  loader,
  files: new Set(
    [...readFileSync(join(process.cwd(), loader), "utf8")
      .matchAll(/messages\/\$\{locale\}\/([^"'`]+\.json)/g)].map((match) => match[1]),
  ),
}));

// Any name one loader imports that the other does not is a drift bug on its own,
// whether or not the file exists.
const loaderDriftOffenses = loaderImports.flatMap(({ loader, files }) =>
  loaderImports
    .filter((other) => other.loader !== loader)
    .flatMap((other) =>
      [...files]
        .filter((fileName) => !other.files.has(fileName))
        .map((fileName) => ({
          messageFile: other.loader,
          detail: `imports drifted: ${loader} loads ${fileName} but ${other.loader} does not`,
        })),
    ),
);

// A missing import in either loader must fail, so intersect rather than union.
const importedTopLevelFiles = new Set(
  [...loaderImports[0].files].filter((fileName) =>
    loaderImports.every(({ files }) => files.has(fileName)),
  ),
);
const staticLoansKeys = collectStaticLoansKeys();
const requiredTransactionTypeKeys = [
  "transaction-type-CARD_CREDIT",
  "transaction-type-CHARGE",
  "transaction-type-CHARGE_REFUND",
];

const offenses = [
  ...loaderDriftOffenses,
  ...jsonFiles.flatMap((filePath) => {
  const content = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  const fileOffenses = [
    ...findDuplicateJsonKeys(content, filePath),
    ...findDotKeys(parsed, filePath),
  ];
  const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath;
  if (topLevelFileGaps[fileName].length > 0) {
    fileOffenses.push({
      messageFile: filePath,
      detail: `missing in locales: ${topLevelFileGaps[fileName].join(", ")}`,
    });
  }
  if (!importedTopLevelFiles.has(fileName)) {
    fileOffenses.push({
      messageFile: filePath,
      detail: `not imported by ${MESSAGE_LOADERS.join(" and ")}`,
    });
  }
  if (fileName === "loans.json") {
    const loansMessages = (parsed as Record<string, unknown>).loans;
    for (const key of staticLoansKeys) {
      if (getNestedValue(loansMessages, key) == null) {
        fileOffenses.push({ messageFile: filePath, detail: `missing loans.${key}` });
      }
    }
  }
  if (fileName === "common.json") {
    for (const key of requiredTransactionTypeKeys) {
      const label = (parsed as Record<string, unknown>)[key];
      if (typeof label !== "string" || label.trim() === "" || label === key) {
        fileOffenses.push({ messageFile: filePath, detail: `missing translated label for ${key}` });
      }
    }
  }
  return fileOffenses;
  }),
];

if (offenses.length > 0) {
  console.error("Found i18n regression checks failures:\n");
  for (const offense of offenses) {
    console.error(`- ${offense.messageFile}: ${offense.detail}`);
  }
  process.exitCode = 1;
} else {
  assert.equal(offenses.length, 0);
}
