interface InflectionRule {
  regexp: RegExp;
  replacement: string;
}

function rules(pairs: readonly (readonly [RegExp, string])[], unicodeCaseFolding = false): InflectionRule[] {
  return pairs.map(([regexp, replacement]) => ({
    regexp: unicodeCaseFolding && regexp.ignoreCase && !regexp.unicode && !regexp.flags.includes("v")
      ? new RegExp(regexp.source, `${regexp.flags}u`) : regexp,
    replacement,
  }));
}

export interface DeckInflectionConfig {
  uncountables?: readonly string[];
  singular?: readonly (readonly [RegExp, string])[];
  plural?: readonly (readonly [RegExp, string])[];
}

type DeckInflectionsListener = () => void;
const deckInflectionsListeners: DeckInflectionsListener[] = [];

export function onDeckInflectionsChanged(listener: DeckInflectionsListener): void {
  deckInflectionsListeners.push(listener);
}

function notifyDeckInflectionsChanged(): void {
  for (const listener of deckInflectionsListeners) listener();
}

const DEFAULT_SINGULAR_RULES: readonly InflectionRule[] = rules([
  [/(z)ombies$/i, "$1ombie"],
  [/(z)ombie$/i, "$1ombie"],
  [/(m)oves$/i, "$1ove"],
  [/(m)ove$/i, "$1ove"],
  [/(s)exes$/i, "$1ex"],
  [/(s)ex$/i, "$1ex"],
  [/(c)hildren$/i, "$1hild"],
  [/(c)hild$/i, "$1hild"],
  [/(m)en$/i, "$1an"],
  [/(m)an$/i, "$1an"],
  [/(p)eople$/i, "$1erson"],
  [/(p)erson$/i, "$1erson"],
  [/(database)s$/i, "$1"],
  [/(quiz)zes$/i, "$1"],
  [/(matr)ices$/i, "$1ix"],
  [/(vert|ind)ices$/i, "$1ex"],
  [/^(ox)en/i, "$1"],
  [/(alias|status)(es)?$/i, "$1"],
  [/(octop|vir)(us|i)$/i, "$1us"],
  [/^(a)x[ie]s$/i, "$1xis"],
  [/(cris|test)(is|es)$/i, "$1is"],
  [/(shoe)s$/i, "$1"],
  [/(o)es$/i, "$1"],
  [/(bus)(es)?$/i, "$1"],
  [/^(m|l)ice$/i, "$1ouse"],
  [/(x|ch|ss|sh)es$/i, "$1"],
  [/(m)ovies$/i, "$1ovie"],
  [/(s)eries$/i, "$1eries"],
  [/([^aeiouy]|qu)ies$/i, "$1y"],
  [/([lr])ves$/i, "$1f"],
  [/(tive)s$/i, "$1"],
  [/(hive)s$/i, "$1"],
  [/([^f])ves$/i, "$1fe"],
  [/(^analy)(sis|ses)$/i, "$1sis"],
  [/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/i, "$1sis"],
  [/([ti])a$/i, "$1um"],
  [/(n)ews$/i, "$1ews"],
  [/(ss)$/i, "$1"],
  [/s$/i, ""],
], true);

const DEFAULT_PLURAL_RULES: readonly InflectionRule[] = rules([
  [/(z)ombies$/i, "$1ombies"],
  [/(z)ombie$/i, "$1ombies"],
  [/(m)oves$/i, "$1oves"],
  [/(m)ove$/i, "$1oves"],
  [/(s)exes$/i, "$1exes"],
  [/(s)ex$/i, "$1exes"],
  [/(c)hildren$/i, "$1hildren"],
  [/(c)hild$/i, "$1hildren"],
  [/(m)en$/i, "$1en"],
  [/(m)an$/i, "$1en"],
  [/(p)eople$/i, "$1eople"],
  [/(p)erson$/i, "$1eople"],
  [/(quiz)$/i, "$1zes"],
  [/^(oxen)$/i, "$1"],
  [/^(ox)$/i, "$1en"],
  [/^(m|l)ice$/i, "$1ice"],
  [/^(m|l)ouse$/i, "$1ice"],
  [/(matr|vert|ind)(?:ix|ex)$/i, "$1ices"],
  [/(x|ch|ss|sh)$/i, "$1es"],
  [/([^aeiouy]|qu)y$/i, "$1ies"],
  [/(hive)$/i, "$1s"],
  [/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
  [/sis$/i, "ses"],
  [/([ti])a$/i, "$1a"],
  [/([ti])um$/i, "$1a"],
  [/(buffal|tomat)o$/i, "$1oes"],
  [/(bu)s$/i, "$1ses"],
  [/(alias|status)$/i, "$1es"],
  [/(octop|vir)i$/i, "$1i"],
  [/(octop|vir)us$/i, "$1i"],
  [/^(ax|test)is$/i, "$1es"],
  [/s$/i, "s"],
  [/$/, "s"],
], true);

const DEFAULT_UNCOUNTABLE_WORDS: readonly string[] = [
  "equipment",
  "information",
  "rice",
  "money",
  "species",
  "series",
  "fish",
  "sheep",
  "jeans",
  "police",
];

interface InflectionState {
  singularRules: readonly InflectionRule[];
  pluralRules: readonly InflectionRule[];
  uncountableRegexes: readonly RegExp[];
}

function buildUncountableRegexes(words: readonly string[]): readonly RegExp[] {
  return words.map((word) => new RegExp(`\\b${word}$`, "iu"));
}

let inflectionState: InflectionState = {
  singularRules: DEFAULT_SINGULAR_RULES,
  pluralRules: DEFAULT_PLURAL_RULES,
  uncountableRegexes: buildUncountableRegexes(DEFAULT_UNCOUNTABLE_WORDS),
};

let lastAppliedConfig: DeckInflectionConfig | undefined;

export function applyDeckInflections(config: DeckInflectionConfig): void {
  if (config === lastAppliedConfig) return;
  lastAppliedConfig = config;
  const deckSingular = config.singular ? rules(config.singular).reverse() : [];
  const deckPlural = config.plural ? rules(config.plural).reverse() : [];
  const uncountableWords = config.uncountables
    ? [...DEFAULT_UNCOUNTABLE_WORDS, ...config.uncountables]
    : DEFAULT_UNCOUNTABLE_WORDS;
  inflectionState = {
    singularRules: [...deckSingular, ...DEFAULT_SINGULAR_RULES],
    pluralRules: [...deckPlural, ...DEFAULT_PLURAL_RULES],
    uncountableRegexes: buildUncountableRegexes(uncountableWords),
  };
  notifyDeckInflectionsChanged();
}

export function resetDeckInflections(): void {
  lastAppliedConfig = undefined;
  inflectionState = {
    singularRules: DEFAULT_SINGULAR_RULES,
    pluralRules: DEFAULT_PLURAL_RULES,
    uncountableRegexes: buildUncountableRegexes(DEFAULT_UNCOUNTABLE_WORDS),
  };
  notifyDeckInflectionsChanged();
}

function uncountable(word: string): boolean {
  return inflectionState.uncountableRegexes.some((re) => re.test(word));
}

function applyInflections(word: string, rulesInScanOrder: readonly InflectionRule[]): string {
  if (word === "" || uncountable(word)) return word;
  for (const { regexp, replacement } of rulesInScanOrder) {
    if (regexp.test(word)) {
      return word.replace(regexp, replacement);
    }
  }
  return word;
}

export function singularize(word: string): string {
  return applyInflections(word, inflectionState.singularRules);
}

export function pluralize(word: string): string {
  return applyInflections(word, inflectionState.pluralRules);
}

export function underscore(camelCasedWord: string): string {
  if (!/[A-Z-]|::/.test(camelCasedWord)) return camelCasedWord;
  const word = camelCasedWord.replace(/::/g, "/");
  return word
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])|(?<=[a-z\d])(?=[A-Z])/g, "_")
    .replace(/-/g, "_")
    .toLowerCase();
}

export function titleize(word: string): string {
  const humanized = underscore(word)
    .replace(/_/g, " ")
    .replace(/^\s+/, "")
    .replace(/^./, (c) => c.toUpperCase());
  return humanized.replace(/\b(?<!\w['’`()])[a-z]/g, (c) => c.toUpperCase());
}

export function rubyCapitalize(str: string): string {
  if (str === "") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function isAsciiDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isAsciiLower(c: string): boolean {
  return c >= "a" && c <= "z";
}
function isAsciiUpper(c: string): boolean {
  return c >= "A" && c <= "Z";
}
function isAsciiAlnum(c: string): boolean {
  return isAsciiDigit(c) || isAsciiLower(c) || isAsciiUpper(c);
}

export function rubySucc(str: string): string {
  if (str === "") return str;
  const chars = Array.from(str);

  let lastAlnum = -1;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (isAsciiAlnum(chars[i] as string)) {
      lastAlnum = i;
      break;
    }
  }
  if (lastAlnum < 0) {
    const lastIdx = chars.length - 1;
    chars[lastIdx] = String.fromCharCode((chars[lastIdx] as string).codePointAt(0)! + 1);
    return chars.join("");
  }

  const lastChar = chars[lastAlnum] as string;
  const neighbor = isAsciiDigit(lastChar) ? "1" : isAsciiLower(lastChar) ? "a" : "A";
  const neighborFor = (c: string): string => (isAsciiDigit(c) ? "1" : isAsciiLower(c) ? "a" : "A");

  let carry = true;
  let i = lastAlnum;
  while (i >= 0) {
    const c = chars[i] as string;
    if (isAsciiDigit(c)) {
      carry = c === "9";
      chars[i] = carry ? "0" : String.fromCharCode(c.charCodeAt(0) + 1);
    } else if (isAsciiLower(c)) {
      carry = c === "z";
      chars[i] = carry ? "a" : String.fromCharCode(c.charCodeAt(0) + 1);
    } else if (isAsciiUpper(c)) {
      carry = c === "Z";
      chars[i] = carry ? "A" : String.fromCharCode(c.charCodeAt(0) + 1);
    } else {
      let j = i - 1;
      while (j >= 0 && !isAsciiAlnum(chars[j] as string)) j--;
      if (j < 0 || (neighbor === "1" && !isAsciiDigit(chars[j] as string))) {
        chars.splice(i + 1, 0, neighbor);
        return chars.join("");
      }
      i = j;
      continue;
    }
    if (!carry) break;
    if (i === 0) {
      chars.unshift(neighborFor(chars[0] as string));
      return chars.join("");
    }
    i--;
  }
  return chars.join("");
}

export function regexpQuote(str: string): string {
  return str.replace(/[^\w\s-]/g, (c) => `\\${c}`);
}
