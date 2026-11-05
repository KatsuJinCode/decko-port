import { HtmlTokenEncoder } from "../encoder.js";

export function scanRuby(input: string): string | undefined {
  const enc = new HtmlTokenEncoder();
  return scanRubyInto(enc, input) ? enc.toString() : undefined;
}

const IDENT_START = "[\\p{L}_\\u{80}-\\u{10FFFF}]";
const ALNUM = "[\\p{L}\\p{N}_\\u{80}-\\u{10FFFF}]";
const IDENT = `${IDENT_START}${ALNUM}*`;

const METHOD_SUFFIX = "(?:[?!]|=(?![~>]|=(?!>)))";
const METHOD_NAME_OPERATOR =
  "\\*\\*?|[-+~]@?|[\\/%&|^`]|\\[\\]=?|<<|>>|<=?>?|>=?|===?|=~|![~=@]?";
const METHOD_NAME = `${IDENT}[?!]?`;
const METHOD_NAME_EX = `(?:${IDENT}${METHOD_SUFFIX}?|${METHOD_NAME_OPERATOR})`;
const METHOD_AFTER_DOT = `(?:${IDENT}[?!]?|${METHOD_NAME_OPERATOR})`;

const GLOBAL_VARIABLE =
  "\\$(?:" + IDENT + "|[1-9]\\d*|0\\w*|[~&+`'=\\/,;_.<>!@$?*\":\\\\]|-[a-zA-Z_0-9])";

const DECIMAL = "\\d+(?:_\\d+)*";
const OCTAL = "0_?[0-7]+(?:_[0-7]+)*";
const HEXADECIMAL = "0x[0-9A-Fa-f]+(?:_[0-9A-Fa-f]+)*";
const BINARY = "0b[01]+(?:_[01]+)*";
const EXPONENT = `[eE][+-]?${DECIMAL}`;
const FLOAT_SUFFIX = `(?:${EXPONENT}|\\.${DECIMAL}(?:${EXPONENT})?)`;
const NUMERIC_F = `(?:(?=0)(?:${OCTAL}|${HEXADECIMAL}|${BINARY})|${DECIMAL}(?<fs>${FLOAT_SUFFIX})?)`;

const VALUE_FOLLOWS =
  "(?:[ \\t\\f\\v]+)(?:(?:[%\\/][^\\s=])|(?:<<-?\\S)|(?:[-+]\\d))";

const SIMPLE_ESCAPE = "(?:[abefnrstv]|[0-7]{1,3}|x[0-9A-Fa-f]{1,2}|[\\s\\S])";

type ParserState =
  | "initial"
  | "def_expected"
  | "dot_expected"
  | "module_expected"
  | "undef_expected"
  | "undef_comma_expected"
  | "alias_expected";

const KEYWORDS = new Set([
  "and", "def", "end", "in", "or", "unless", "begin", "defined?", "ensure",
  "module", "redo", "super", "until", "BEGIN", "break", "do", "next", "rescue",
  "then", "when", "END", "case", "else", "for", "retry", "while", "alias",
  "class", "elsif", "if", "not", "return", "undef", "yield",
]);

const KEYWORD_NEW_STATE = new Map<string, ParserState>([
  ["def", "def_expected"],
  ["undef", "undef_expected"],
  ["alias", "alias_expected"],
  ["class", "module_expected"],
  ["module", "module_expected"],
]);

const KEYWORDS_EXPECTING_VALUE = new Set([
  "and", "end", "in", "or", "unless", "begin", "defined?", "ensure", "redo",
  "super", "until", "break", "do", "next", "rescue", "then", "when", "case",
  "else", "for", "retry", "while", "elsif", "if", "not", "return", "yield",
]);

const PREDEFINED_CONSTANTS = new Set([
  "nil", "true", "false", "self", "DATA", "ARGV", "ARGF", "ENV", "FALSE",
  "TRUE", "NIL", "STDERR", "STDIN", "STDOUT", "TOPLEVEL_BINDING",
  "RUBY_COPYRIGHT", "RUBY_DESCRIPTION", "RUBY_ENGINE", "RUBY_PATCHLEVEL",
  "RUBY_PLATFORM", "RUBY_RELEASE_DATE", "RUBY_REVISION", "RUBY_VERSION",
  "__FILE__", "__LINE__", "__ENCODING__",
]);

class StringState {
  readonly interpreted: boolean;
  readonly delim: string;
  readonly pattern: RegExp;
  next_state: ParserState = "initial";

  constructor(kind: string, interpreted: boolean, delim: string) {
    this.interpreted = interpreted;
    this.delim = delim;
    this.pattern = new RegExp(
      interpreted ? `(?=[${delim}\\\\]|#[{$@])` : `(?=[${delim}\\\\])`,
      "gm",
    );
    void kind;
  }
}

class Src {
  readonly s: string;
  pos = 0;
  private lastExec: RegExpExecArray | null = null;
  constructor(s: string) {
    this.s = s;
  }
  get eos(): boolean {
    return this.pos >= this.s.length;
  }
  scan(re: RegExp): string | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.s);
    if (m === null || m.index !== this.pos) return null;
    this.pos = re.lastIndex;
    this.lastExec = m;
    return m[0];
  }
  check(re: RegExp): string | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.s);
    if (m === null || m.index !== this.pos) return null;
    return m[0];
  }
  named(name: string): string | undefined {
    return this.lastExec?.groups?.[name];
  }
  scanUntil(re: RegExp): string | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.s);
    if (m === null) return null;
    const end = re.lastIndex;
    const consumed = this.s.slice(this.pos, end);
    this.pos = end;
    return consumed;
  }
  getch(): string {
    const ch = this.s[this.pos];
    this.pos += 1;
    return ch;
  }
  peek(n: number): string {
    return this.s.slice(this.pos, this.pos + n);
  }
  bol(): boolean {
    return this.pos === 0 || this.s[this.pos - 1] === "\n";
  }
}

function stringSimpleKeyPattern(delim: string): RegExp {
  return delim === "'"
    ? /(?:(?:[^\\']+|\\.)*)' :/y
    : /(?:(?:[^\\"#]+|\\.|#\$[\\"]|#\{[^{}]+\}|#(?!\{))*)" :/y;
}

const METHOD_NAME_EX_RE = new RegExp(`(?:${METHOD_NAME_EX})`, "yu");
const NO_DOT_SCOPE_RE = /(?:\.|::)/y;

function scanMethodExNoDot(src: Src): string | null {
  const m = src.scan(METHOD_NAME_EX_RE);
  if (m === null) return null;
  NO_DOT_SCOPE_RE.lastIndex = src.pos;
  if (NO_DOT_SCOPE_RE.exec(src.s) !== null) {
    src.pos -= m.length;
    return null;
  }
  return m;
}

const RE_SPACE = /[ \t\f\v]+/y;
const RE_NEWLINE = /\n/y;
const RE_BSLASH_NEWLINE = /\\\n/y;
const RE_COMMENT = /#.*/y;
const RE_RUBYDOC = /^=begin(?!\S)/my;
const RE_DATA_END = /^__END__$/my;
const RE_COLON_KEY = /:(?!:)/y;
const RE_CONST_PAREN = /\(/y;
const RE_OP1 =
  /(?:(?<dot>\.(?!\.)|::)|(?<val>\.\.\.?|==?=?|[,([{])|[\])}])/y;
const RE_QUOTED_SYMBOL = /:['"]/y;
const RE_OP2 = /[-+!~^\/]=?|[:;]|&\.|[*|&]{1,2}=?|>>?/y;
const RE_HEREDOC = /<</y;
const RE_FANCY = /%(?:[iIqQrswWx]|(?![a-zA-Z0-9]))[^a-zA-Z0-9]/y;
const RE_CHAR_LIT = /\?(?:[^\s\\]|\\)/y;
const RE_OP3 = /%=?|<(?:<|=>?)?|\?/y;
const RE_BACKTICK = /`/y;
const RE_BSLASH_EOF = /\\$/y;
const RE_DOT_OR_DC = /\.|::/y;
const RE_SHL = /<</y;
const RE_COMMA = /,/y;
const RE_STR_SIMPLE = /'(?:(?:[^'\\]*)')?|"(?:(?:[^"\\#\n]*)")?/y;
const RE_TRAILING_COLON = /:/y;
const RE_R_SUFFIX = /r/y;
const RE_I_SUFFIX = /i/y;
const RE_VALUE_FOLLOWS = new RegExp(VALUE_FOLLOWS, "y");

function scanTokens(src: Src, enc: HtmlTokenEncoder): boolean {
  let state: ParserState | StringState = "initial";
  let lastState: ParserState | StringState | undefined = undefined;
  let methodCallExpected: string | boolean = false;
  let valueExpected: boolean | "colon" = true;

  for (;;) {
    if (src.eos) break;

    if (state instanceof StringState) {
      const content = src.scanUntil(state.pattern);
      if (content !== null) {
        if (content !== "") {
          enc.textToken(content, "content");
          if (src.eos) break;
        }
      } else {
        const rest = src.s.slice(src.pos);
        src.pos = src.s.length;
        if (rest !== "") enc.textToken(rest, "content");
        break;
      }
      const ch = src.getch();
      if (ch === state.delim) {
        enc.textToken(ch, "delimiter");
        enc.endGroup();
        valueExpected = false;
        state = state.next_state;
      } else if (ch === "\\") {
        if (state.interpreted) {
          const esc = src.scan(new RegExp(`(?:${SIMPLE_ESCAPE})`, "my"));
          if (esc !== null) {
            enc.textToken(ch + esc, "char");
          } else {
            enc.textToken(ch, "error");
          }
        } else {
          const esc = src.eos ? null : src.getch();
          if (esc === null) {
            enc.textToken(ch, "content");
          } else if (esc === state.delim || esc === "\\") {
            enc.textToken(ch + esc, "char");
          } else {
            enc.textToken(ch + esc, "content");
          }
        }
      } else if (ch === "#") {
        const next = src.peek(1);
        if (next === "{") {
          return false;
        } else if (next === "$" || next === "@") {
          enc.textToken(ch, "escape");
          lastState = state;
          state = "initial";
        } else {
          return false;
        }
      } else {
        return false;
      }
    } else {
      let m: string | null;
      let handledPrologue = true;
      if ((m = src.scan(RE_SPACE)) !== null) {
        enc.textToken(m, "space");
      } else if ((m = src.scan(RE_NEWLINE)) !== null) {
        valueExpected = true;
        if (state === "undef_comma_expected") state = "initial";
        enc.textToken(m, "space");
      } else if (src.check(/#/y) !== null) {
        if (src.check(RE_RUBYDOC) !== null || src.check(RE_DATA_END) !== null) {
          return false;
        }
        const comment = src.scan(RE_COMMENT)!;
        enc.textToken(comment, comment.startsWith("#!") ? "doctype" : "comment");
      } else if ((m = src.scan(RE_BSLASH_NEWLINE)) !== null) {
        enc.textToken(m, "space");
      } else {
        handledPrologue = false;
      }

      if (!handledPrologue) {
      if (state === "initial") {
      let m: string | null;
      initialArms: {
        if (!methodCallExpected) {
          m = src.scan(new RegExp(`${METHOD_NAME}`, "yu"));
          if (m === null) {
            const op1 = src.scan(RE_OP1);
            if (op1 !== null) {
              const dot = src.named("dot");
              methodCallExpected = dot !== undefined ? dot : false;
              valueExpected = !methodCallExpected && src.named("val") !== undefined;
              enc.textToken(op1, "operator");
              break initialArms;
            }
          } else {
            let kind = "ident";
            if (PREDEFINED_CONSTANTS.has(m)) kind = "predefined_constant";
            if (KEYWORDS.has(m)) kind = "keyword";
            const colon = valueExpected !== "colon" ? src.scan(RE_COLON_KEY) : null;
            if (colon !== null) {
              valueExpected = true;
              enc.textToken(m, "key");
              enc.textToken(":", "operator");
            } else {
              valueExpected = false;
              if (kind === "ident") {
                if (/^[A-Z]/.test(m) && !/[!?]$/.test(m) && src.check(RE_CONST_PAREN) === null) {
                  kind = "constant";
                }
              } else if (kind === "keyword") {
                const nextState = KEYWORD_NEW_STATE.get(m);
                if (nextState !== undefined) state = nextState;
                if (KEYWORDS_EXPECTING_VALUE.has(m)) {
                  valueExpected = m === "when" ? "colon" : true;
                }
              }
              if (!valueExpected && src.check(RE_VALUE_FOLLOWS) !== null) {
                valueExpected = true;
              }
              enc.textToken(m, kind);
            }
            break initialArms;
          }
        } else {
          m = src.scan(new RegExp(`${METHOD_AFTER_DOT}`, "yu"));
          if (m !== null) {
            if (methodCallExpected === "::" && /^[A-Z]/.test(m) && src.check(RE_CONST_PAREN) === null) {
              enc.textToken(m, "constant");
            } else {
              enc.textToken(m, "ident");
            }
            methodCallExpected = false;
            valueExpected = src.check(RE_VALUE_FOLLOWS) !== null;
            break initialArms;
          }
        }

        if (src.check(RE_QUOTED_SYMBOL) !== null) return false;
        m = src.scan(new RegExp(`:(?:${METHOD_NAME_EX}|${GLOBAL_VARIABLE})`, "yu"));
        if (m !== null) {
          enc.textToken(m, "symbol");
          valueExpected = false;
          break initialArms;
        }

        m = src.scan(RE_STR_SIMPLE);
        if (m !== null) {
          if (m.length === 1) {
            const kind = src.check(stringSimpleKeyPattern(m)) !== null ? "key" : "string";
            enc.beginGroup(kind);
            enc.textToken(m, "delimiter");
            state = new StringState(kind, m === '"', m);
          } else {
            const kind = valueExpected === true && src.scan(RE_TRAILING_COLON) !== null ? "key" : "string";
            enc.beginGroup(kind);
            enc.textToken(m[0], "delimiter");
            if (m.length > 2) enc.textToken(m.slice(1, -1), "content");
            enc.textToken(m[m.length - 1], "delimiter");
            enc.endGroup();
            if (kind === "key") enc.textToken(":", "operator");
            valueExpected = false;
          }
          break initialArms;
        }

        m = src.scan(new RegExp(`@${IDENT}`, "yu"));
        if (m !== null) {
          valueExpected = false;
          enc.textToken(m, "instance_variable");
          break initialArms;
        }

        if (valueExpected !== false && src.check(/\//y) !== null) return false;

        m = src.scan(new RegExp(`${valueExpected !== false ? "(?:[-+]?)" : ""}(?:${NUMERIC_F})`, "y"));
        if (m !== null) {
          if (methodCallExpected !== false) {
            enc.textToken(m, "error");
            methodCallExpected = false;
          } else {
            let text = m;
            const kind = src.named("fs") !== undefined ? "float" : "integer";
            if (!/[eE]/.test(text) && src.scan(RE_R_SUFFIX) !== null) text += "r";
            if (src.scan(RE_I_SUFFIX) !== null) text += "i";
            enc.textToken(text, kind);
          }
          valueExpected = false;
          break initialArms;
        }

        if ((m = src.scan(RE_OP2)) !== null) {
          valueExpected = true;
          enc.textToken(m, "operator");
          break initialArms;
        }

        if (valueExpected !== false && src.check(RE_HEREDOC) !== null) return false;
        if (valueExpected !== false && src.check(RE_FANCY) !== null) return false;
        if (valueExpected !== false && src.check(RE_CHAR_LIT) !== null) return false;

        if ((m = src.scan(RE_OP3)) !== null) {
          valueExpected = m === "?" ? "colon" : true;
          enc.textToken(m, "operator");
          break initialArms;
        }

        if (src.check(RE_BACKTICK) !== null) return false;

        m = src.scan(new RegExp(`${GLOBAL_VARIABLE}`, "yu"));
        if (m !== null) {
          enc.textToken(m, "global_variable");
          valueExpected = false;
          break initialArms;
        }

        m = src.scan(new RegExp(`@@${IDENT}`, "yu"));
        if (m !== null) {
          valueExpected = false;
          enc.textToken(m, "class_variable");
          break initialArms;
        }

        if ((m = src.scan(RE_BSLASH_EOF)) !== null) {
          enc.textToken(m, "space");
          break initialArms;
        }

        if (methodCallExpected !== false) {
          methodCallExpected = false;
        } else {
          enc.textToken(src.getch(), "error");
        }
      }

      if (lastState !== undefined && !(state instanceof StringState)) {
        state = lastState;
        lastState = undefined;
      }
    } else if (state === "def_expected") {
      const match = scanMethodExNoDot(src);
      if (match !== null) {
        enc.textToken(match, "method");
        state = "initial";
      } else {
        lastState = "dot_expected";
        state = "initial";
      }
    } else if (state === "dot_expected") {
      const match = src.scan(RE_DOT_OR_DC);
      if (match !== null) {
        state = "def_expected";
        enc.textToken(match, "operator");
      } else {
        state = "initial";
      }
    } else if (state === "module_expected") {
      const shl = src.scan(RE_SHL);
      if (shl !== null) {
        enc.textToken(shl, "operator");
      } else {
        state = "initial";
        const name = src.scan(new RegExp(`(?:(?:${IDENT})::)*${IDENT}`, "yu"));
        if (name !== null) {
          enc.textToken(name, "class");
        }
      }
    } else if (state === "undef_expected") {
      state = "undef_comma_expected";
      const name = scanMethodExNoDot(src);
      if (name !== null) {
        enc.textToken(name, "method");
      } else {
        if (src.check(RE_QUOTED_SYMBOL) !== null) return false;
        const sym = src.scan(
          new RegExp(`:(?:${METHOD_NAME_EX}|${GLOBAL_VARIABLE})`, "yu"),
        );
        if (sym !== null) {
          enc.textToken(sym, "symbol");
        } else {
          state = "initial";
        }
      }
    } else if (state === "undef_comma_expected") {
      const comma = src.scan(RE_COMMA);
      if (comma !== null) {
        enc.textToken(comma, "operator");
        state = "undef_expected";
      } else {
        state = "initial";
      }
    } else if (state === "alias_expected") {
      const pair = src.scan(
        new RegExp(
          `(?<g1>${METHOD_NAME_EX}|${GLOBAL_VARIABLE}|:${METHOD_NAME_EX})(?<g2>[ \\t]+)(?<g3>${METHOD_NAME_EX}|${GLOBAL_VARIABLE}|:${METHOD_NAME_EX})`,
          "yu",
        ),
      );
      if (pair !== null) {
        enc.textToken(
          src.named("g1")!,
          src.named("g1")!.startsWith(":") ? "symbol" : "method",
        );
        enc.textToken(src.named("g2")!, "space");
        enc.textToken(
          src.named("g3")!,
          src.named("g3")!.startsWith(":") ? "symbol" : "method",
        );
      }
      state = "initial";
      }
      }
    }
  }

  if (state instanceof StringState) {
    enc.endGroup();
  }
  return true;
}

export function scanRubyInto(enc: HtmlTokenEncoder, input: string): boolean {
  return scanTokens(new Src(input), enc);
}
