export const RANDOMIZED_SLOT_ATTRIBUTE = 'data-slot-id="RANDOMIZED"';

const SLOT_ID_PATTERN = /data-slot-id=(['"])([0-9a-f]{20})\1/g;

const ESCAPED_SLOT_ID_PATTERN = /data-slot-id=&quot;([0-9a-f]{20})&quot;/g;
const ESCAPED_RANDOMIZED_SLOT_ATTRIBUTE = "data-slot-id=&quot;RANDOMIZED&quot;";

const ACCORDION_GROUP_HASH_PATTERN = /(card-[0-9a-z_:]+-)-?[0-9]+(-collapse-id)/g;

export const RANDOMIZED_GROUP_TOKEN = "HASH";

export function normalizeAccordionGroupIds(html: string): string {
  return html.replace(ACCORDION_GROUP_HASH_PATTERN, `$1${RANDOMIZED_GROUP_TOKEN}$2`);
}

export function normalizeSlotIds(html: string): string {
  return html
    .replace(SLOT_ID_PATTERN, RANDOMIZED_SLOT_ATTRIBUTE)
    .replace(ESCAPED_SLOT_ID_PATTERN, ESCAPED_RANDOMIZED_SLOT_ATTRIBUTE);
}

export function maskSlotIdValues(html: string): string {
  return html
    .replace(SLOT_ID_PATTERN, (_m, q: string) => `data-slot-id=${q}RANDOMIZED${q}`)
    .replace(ESCAPED_SLOT_ID_PATTERN, ESCAPED_RANDOMIZED_SLOT_ATTRIBUTE);
}

export function referenceErasedSlotQuotes(expected: string): boolean {
  return expected.includes(RANDOMIZED_SLOT_ATTRIBUTE) || expected.includes(ESCAPED_RANDOMIZED_SLOT_ATTRIBUTE);
}

const CF_CHALLENGE_BLOCK_PATTERN =
  /<script>(?:(?!<\/script>)[\s\S])*__CF\$cv\$params(?:(?!<\/script>)[\s\S])*<\/script>/g;

export function normalizeCloudflareChallengeBlocks(html: string): string {
  return html.replace(CF_CHALLENGE_BLOCK_PATTERN, "");
}

const MOD_OBJECT_ADDRESS_PATTERN = /#<Cardio::Mod:0x[0-9a-f]{16}>/g;

export const NORMALIZED_MOD_OBJECT_ADDRESS = "ADDRESS";

export function normalizeModObjectAddresses(html: string): string {
  return html.replace(
    MOD_OBJECT_ADDRESS_PATTERN,
    `#<Cardio::Mod:${NORMALIZED_MOD_OBJECT_ADDRESS}>`,
  );
}

export function normalizeForReplay(html: string, keepSlotQuotes = false): string {
  const slots = keepSlotQuotes ? maskSlotIdValues(html) : normalizeSlotIds(html);
  return normalizeCloudflareChallengeBlocks(normalizeModObjectAddresses(normalizeAccordionGroupIds(slots)));
}

export interface FirstDifference {
  codeUnitOffset: number;
  byteOffset: number;
  expectedChar: string;
  actualChar: string;
  expectedExcerpt: string;
  actualExcerpt: string;
}

export interface ByteDiffResult {
  equal: boolean;
  expectedCodeUnits: number;
  actualCodeUnits: number;
  expectedBytes: number;
  actualBytes: number;
  firstDifference: FirstDifference | null;
}

const CONTEXT_RADIUS = 48;

function excerptOf(text: string, center: number, radius: number): string {
  const start = Math.max(0, center - radius);
  const end = Math.min(text.length, center + radius);
  const body = text.slice(start, end);
  const head = start > 0 ? "..." : "";
  const tail = end < text.length ? "..." : "";
  return `${head}${body}${tail}`;
}

export function byteDiff(
  expected: string,
  actual: string,
  contextRadius: number = CONTEXT_RADIUS
): ByteDiffResult {
  const minLength = Math.min(expected.length, actual.length);
  let offset = 0;
  while (offset < minLength && expected.charCodeAt(offset) === actual.charCodeAt(offset)) {
    offset += 1;
  }

  if (offset === expected.length && offset === actual.length) {
    return {
      equal: true,
      expectedCodeUnits: expected.length,
      actualCodeUnits: actual.length,
      expectedBytes: Buffer.byteLength(expected, "utf8"),
      actualBytes: Buffer.byteLength(actual, "utf8"),
      firstDifference: null,
    };
  }

  return {
    equal: false,
    expectedCodeUnits: expected.length,
    actualCodeUnits: actual.length,
    expectedBytes: Buffer.byteLength(expected, "utf8"),
    actualBytes: Buffer.byteLength(actual, "utf8"),
    firstDifference: {
      codeUnitOffset: offset,
      byteOffset: Buffer.byteLength(expected.slice(0, offset), "utf8"),
      expectedChar: offset < expected.length ? JSON.stringify(expected[offset]) : '""',
      actualChar: offset < actual.length ? JSON.stringify(actual[offset]) : '""',
      expectedExcerpt: excerptOf(expected, offset, contextRadius),
      actualExcerpt: excerptOf(actual, offset, contextRadius),
    },
  };
}

export function compareNormalized(
  expected: string,
  actual: string,
  contextRadius: number = CONTEXT_RADIUS
): ByteDiffResult {
  const keepSlotQuotes = !referenceErasedSlotQuotes(expected);
  return byteDiff(
    normalizeForReplay(expected, keepSlotQuotes),
    normalizeForReplay(actual, keepSlotQuotes),
    contextRadius,
  );
}
