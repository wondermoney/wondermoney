import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const locales = ["en", "pt", "es", "fr", "de", "it"];
export const root = fileURLToPath(new URL("../", import.meta.url));

const prohibitedPatterns = [
  ["setup/import timing", /90\s*(?:seconds?|segundos?|secondes?|Sekunden?|secondi)|\b(?:in|within|under|em|en|dans|unter|weniger als|menos de|moins de|meno di)\s+(?:(?:\d+|a few|few|poucos|poucas|quelques|wenigen|pochi|poche)\s+)?(?:minutes?|minutos?|minuten|minuti|seconds?|segundos?|secondes?|sekunden?|secondi)\b|\b\d+\s*(?:minutes?|minutos?|minuten|minuti)\b/gimu],
  ["immediate processing", /\b(?:immediately|imediatamente|inmediatamente|immédiatement|immediatamente|sofort|umgehend|subito|de inmediato)\b/gimu],
  ["instant/live freshness", /real[- ]time|tempo real|tiempo real|temps réel|\bechtzeit\b|tempo reale/gimu],
  ["crypto positioning", /\b(?:crypto(?:currenc(?:y|ies))?|cripto(?:moedas?|monedas?|valute)?|crypto-monnaies?|krypto(?:währungen?)?|cryptomonnaies?)\b/gimu],
  ["quantified adoption", /thousands of Europeans|milhares de europeus|miles de europeos|milliers d['’]Européens|Tausenden von Europäern|migliaia di europei/gimu],
  ["Europe-only positioning", /Europe(?:an)?[- ]only|only (?:available )?(?:in|for) Europe|apenas (?:na|para a) Europa|solo (?:en|para) Europa|uniquement (?:en|pour) (?:l['’])?Europe|nur (?:in|für) Europa|solo (?:in|per) Europa/gimu],
  ["unsupported security/legal guarantee", /bank[- ]level (?:encryption|security)|(?:encryption|security) (?:at )?bank[- ]level|(?:cifrado|seguridad) de nivel bancario|(?:encriptação|segurança) de nível bancário|(?:chiffrement|sécurité) de niveau bancaire|(?:verschlüsselung|sicherheit) auf bankniveau|(?:crittografia|sicurezza) di livello bancario|256[- ]bit|256 bits?|end-to-end|ponta a ponta|extremo a extremo|bout en bout|durchgehend verschlüsselt|European data storage|(?:stored|hosted|storage)[^\n]{0,35}(?:Europe|EU)|(?:armazenad|alojad)[^\n]{0,35}(?:Europa|UE)|(?:almacenad|alojad)[^\n]{0,35}(?:Europa|UE)|(?:stock|héberg)[^\n]{0,35}(?:Europe|UE)|(?:gespeichert|gehostet)[^\n]{0,35}(?:Europa|EU)|(?:archiviat|hosted)[^\n]{0,35}(?:Europa|UE)|anonym(?:ous|ized|ised|amente|isiert|isée|izada|izado)?|(?:GDPR|RGPD|DSGVO)[- ]?(?:compliant|conforme|konform)|(?:conforme|conformidad|conformidade|cumplimiento|conformité)\D{0,15}(?:GDPR|RGPD)|(?:never|nunca|jamais|niemals|non)\s+(?:sell|share|sold|shared|vend\w*|partilh\w*|compart\w*|partag\w*|verkauf\w*|weitergegeben|condiv\w*)/gimu],
];

const ignoredFiles = new Set([
  "scripts/claims-alignment.mjs",
  "scripts/check-claims-alignment.mjs",
  "src/lib/claimsAlignment.test.ts",
]);

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : walk(path);
  return [path];
});

export function classifyMatch(file, context = "") {
  if (/(?:^|\/)(?:docs|plans|archive|historical)(?:\/|$)/i.test(file)) return "historical";
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return "not-claim";
  if (/\bfrom\s+["']node:crypto["']|crossorigin=["']anonymous["']/iu.test(context)) return "technical";
  if (/\.(?:ts|tsx|js|jsx)$/.test(file) && /(?:adapter|client|schema|type|mock|fixture)/i.test(file)) return "technical";
  if (/(?:disconnect|revoke|widerruf|trenn|desconect|revog|déconnect|révoqu|disconnett|revoc)[^\n]{0,80}(?:immediately|imediatamente|inmediatamente|immédiatement|immediatamente|sofort|umgehend|subito|de inmediato)/iu.test(context)) return "not-claim";
  return "claim";
}

export function activeFiles() {
  const localeFiles = locales.flatMap((locale) => [
    `src/locales/${locale}/common.json`,
    `public/locales/${locale}/common.json`,
  ]);
  const sourceFiles = walk(join(root, "src"))
    .filter((file) => [".astro", ".ts", ".tsx", ".js", ".jsx"].includes(extname(file)))
    .map((file) => relative(root, file));
  return [...new Set([...localeFiles, ...sourceFiles])].filter((file) => !ignoredFiles.has(file));
}

export function scanContent(file, content) {
  const matches = [];
  for (const [rule, pattern] of prohibitedPatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const lineStart = content.lastIndexOf("\n", match.index) + 1;
      const lineEnd = content.indexOf("\n", match.index);
      const context = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
      matches.push({ file, rule, text: match[0], classification: classifyMatch(file, context) });
    }
  }
  return matches;
}

export function scanClaims(files = activeFiles()) {
  return files.flatMap((file) => scanContent(file, readFileSync(join(root, file), "utf8")));
}
