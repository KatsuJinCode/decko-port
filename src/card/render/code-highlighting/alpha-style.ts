const ALPHA_TOKEN_COLORS = `.debug { color: white !important; background: blue !important; }

.annotation { color:#007 }
.attribute-name { color:#b48 }
.attribute-value { color:#700 }
.binary { color:#549 }
.binary .char { color:#325 }
.binary .delimiter { color:#325 }
.char { color:#D20 }
.char .content { color:#D20 }
.char .delimiter { color:#710 }
.class { color:#B06; font-weight:bold }
.class-variable { color:#369 }
.color { color:#0A0 }
.comment { color:#777 }
.comment .char { color:#444 }
.comment .delimiter { color:#444 }
.constant { color:#036; font-weight:bold }
.decorator { color:#B0B }
.definition { color:#099; font-weight:bold }
.delimiter { color:black }
.directive { color:#088; font-weight:bold }
.docstring { color:#D42; }
.doctype { color:#34b }
.done { text-decoration: line-through; color: gray }
.entity { color:#800; font-weight:bold }
.error { color:#F00; background-color:#FAA }
.escape  { color:#666 }
.exception { color:#C00; font-weight:bold }
.float { color:#60E }
.function { color:#06B; font-weight:bold }
.function .delimiter { color:#059 }
.function .content { color:#037 }
.global-variable { color:#d70 }
.hex { color:#02b }
.id  { color:#33D; font-weight:bold }
.include { color:#B44; font-weight:bold }
.inline { background-color: hsla(0,0%,0%,0.07); color: black }
.inline-delimiter { font-weight: bold; color: #666 }
.instance-variable { color:#33B }
.integer  { color:#00D }
.imaginary { color:#f00 }
.important { color:#D00 }
.key { color: #606 }
.key .char { color: #60f }
.key .delimiter { color: #404 }
.keyword { color:#080; font-weight:bold }
.label { color:#970; font-weight:bold }
.local-variable { color:#950 }
.map .content { color:#808 }
.map .delimiter { color:#40A}
.map { background-color:hsla(200,100%,50%,0.06); }
.namespace { color:#707; font-weight:bold }
.octal { color:#40E }
.operator { }
.predefined { color:#369; font-weight:bold }
.predefined-constant { color:#069 }
.predefined-type { color:#0a8; font-weight:bold }
.preprocessor { color:#579 }
.pseudo-class { color:#00C; font-weight:bold }
.regexp { background-color:hsla(300,100%,50%,0.06); }
.regexp .content { color:#808 }
.regexp .delimiter { color:#404 }
.regexp .modifier { color:#C2C }
.reserved { color:#080; font-weight:bold }
.shell { background-color:hsla(120,100%,50%,0.06); }
.shell .content { color:#2B2 }
.shell .delimiter { color:#161 }
.string { background-color:hsla(0,100%,50%,0.05); }
.string .char { color: #b0b }
.string .content { color: #D20 }
.string .delimiter { color: #710 }
.string .modifier { color: #E40 }
.symbol { color:#A60 }
.symbol .content { color:#A60 }
.symbol .delimiter { color:#740 }
.tag { color:#070; font-weight:bold }
.type { color:#339; font-weight:bold }
.value { color: #088 }
.variable { color:#037 }

.insert { background: hsla(120,100%,50%,0.12) }
.delete { background: hsla(0,100%,50%,0.12) }
.change { color: #bbf; background: #007 }
.head { color: #f8f; background: #505 }
.head .filename { color: white; }

.delete .eyecatcher { background-color: hsla(0,100%,50%,0.2); border: 1px solid hsla(0,100%,45%,0.5); margin: -1px; border-bottom: none; border-top-left-radius: 5px; border-top-right-radius: 5px; }
.insert .eyecatcher { background-color: hsla(120,100%,50%,0.2); border: 1px solid hsla(120,100%,25%,0.5); margin: -1px; border-top: none; border-bottom-left-radius: 5px; border-bottom-right-radius: 5px; }

.insert .insert { color: #0c0; background:transparent; font-weight:bold }
.delete .delete { color: #c00; background:transparent; font-weight:bold }
.change .change { color: #88f }
.head .head { color: #f4f }`;

const CSS_CLASS_PATTERN = /((?:(?:\s*\.[-\w]+)+\s*,?)+)\s*\{\s*([^\}]+)?\s*\}\s*/g;

const CLASS_TOKEN_PATTERN = /[-\w]+/g;

type StyleTable = Map<string, Map<string, string>>;

function parseStylesheet(stylesheet: string): StyleTable {
  const styles: StyleTable = new Map();
  CSS_CLASS_PATTERN.lastIndex = 0;
  let rule: RegExpExecArray | null;
  while ((rule = CSS_CLASS_PATTERN.exec(stylesheet)) !== null) {
    const selectors = rule[1] ?? "";
    const body = rule[2] ?? "";
    for (const selector of selectors.split(",")) {
      const classes = (selector.match(CLASS_TOKEN_PATTERN) ?? []).slice();
      const own = classes.pop();
      if (own === undefined) continue;
      let ancestors = styles.get(own);
      if (ancestors === undefined) {
        ancestors = new Map<string, string>();
        styles.set(own, ancestors);
      }
      ancestors.set(classes.join(" "), normalizeDeclaration(body));
    }
  }
  return styles;
}

function normalizeDeclaration(body: string): string {
  let out = body.trim();
  out = out.split(" ").join("");
  if (out.endsWith(";")) out = out.slice(0, -1);
  return out;
}

const ALPHA_STYLESHEET: StyleTable = parseStylesheet(ALPHA_TOKEN_COLORS);

export function styleForKindPath(cssClasses: readonly (string | false)[]): string | undefined {
  const first = cssClasses[0];
  if (first === undefined || first === false) return "";
  const family = ALPHA_STYLESHEET.get(first);
  if (family === undefined) return "";
  let style: string | undefined;
  for (let offset = 1; offset <= cssClasses.length; offset++) {
    style = family.get(cssClasses.slice(offset).join(" "));
    if (style !== undefined) break;
  }
  return style;
}

export interface StyleEntry {
  readonly kind: string;
  readonly style: string;
}

const ALPHA_STYLED_KINDS: readonly string[] = [
  "error", "tag", "doctype", "inline", "inline_delimiter",
  "comment", "entity", "preprocessor",
  "attribute_name", "attribute_value",
  "string", "key", "content", "delimiter", "char", "modifier",
  "integer", "float", "value", "constant", "class", "id", "definition",
  "function", "keyword", "reserved", "predefined", "predefined_type",
  "predefined_constant", "namespace", "property", "color", "directive",
  "escape", "annotation", "label", "pseudo_class", "exception",
  "docstring", "decorator", "done", "imaginary", "debug",
  "change", "delete", "head", "insert", "eyecatcher", "filename",
  "binary", "local_variable", "instance_variable", "class_variable",
  "global_variable", "symbol", "variable", "type", "hex", "octal",
  "regexp", "map", "shell", "important", "include",
];

export const ALPHA_STYLES: readonly StyleEntry[] = ALPHA_STYLED_KINDS.map((kind) => ({
  kind,
  style: styleForKindPath([kind]) ?? "",
}));
