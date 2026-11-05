const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  iexcl: "\u00a1",
  cent: "\u00a2",
  pound: "\u00a3",
  curren: "\u00a4",
  yen: "\u00a5",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  plusmn: "\u00b1",
  middot: "\u00b7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  frac12: "\u00bd",
  times: "\u00d7",
  divide: "\u00f7",
  agrave: "\u00e0",
  aacute: "\u00e1",
  egrave: "\u00e8",
  eacute: "\u00e9",
  ecirc: "\u00ea",
  ccedil: "\u00e7",
  ntilde: "\u00f1",
  ouml: "\u00f6",
  uuml: "\u00fc",
  szlig: "\u00df",
  hellip: "\u2026",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decodeHtmlEntities(str: string): string {
  if (!str.includes("&")) return str;
  return str.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const codepoint = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isNaN(codepoint)) return match;
      try {
        return String.fromCodePoint(codepoint);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}
