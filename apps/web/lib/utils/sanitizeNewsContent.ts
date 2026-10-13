const BLOCK_TAGS = /<(\/)?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|blockquote)\b[^>]*>/gi;

const BASIC_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeCodePoint(match: string, codePoint: number) {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return match;
  }

  return String.fromCodePoint(codePoint);
}

function decodeBasicHtmlEntities(value: string) {
  return value.replace(
    /&(#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        return decodeCodePoint(match, Number.parseInt(entity.slice(2), 16));
      }

      if (entity.startsWith("#")) {
        return decodeCodePoint(match, Number.parseInt(entity.slice(1), 10));
      }

      return BASIC_HTML_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

export function stripHtmlToText(html: string) {
  const withoutDangerousBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const withReadableBreaks = withoutDangerousBlocks.replace(BLOCK_TAGS, "\n");
  const strippedTags = withReadableBreaks.replace(/<[^>]+>/g, "");

  return decodeBasicHtmlEntities(strippedTags)
    .replace(/[\t\r\f\v]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
