# CodeRay 1.1.3

The full notice in LICENSE is the upstream v1.1.3 MIT-LICENSE retrieved from
https://raw.githubusercontent.com/rubychan/coderay/v1.1.3/MIT-LICENSE.
No CodeRay executable or additional source is vendored in this directory.

## Modules that transcribe CodeRay 1.1.3

The syntax highlighter under `src/card/render/code-highlighting/` ports
CodeRay 1.1.3 source into TypeScript. LICENSE covers every module below. Each
module's header names the CodeRay files it was transcribed from; this list was
checked against those headers on 2026-11-02.

| Module | CodeRay 1.1.3 source it transcribes |
| --- | --- |
| `src/card/render/code-highlighting/alpha-style.ts` | `lib/coderay/styles/alpha.rb` (`TOKEN_COLORS`, verbatim), `lib/coderay/encoders/html/css.rb` (`CSS#parse`), `lib/coderay/encoders/html.rb` (style lookup) |
| `src/card/render/code-highlighting/encoder.ts` | `lib/coderay/encoders/html.rb` (token and group span assembly) |
| `src/card/render/code-highlighting/escape.ts` | `lib/coderay/encoders/html.rb` (`make_html_escape_hash`) |
| `src/card/render/code-highlighting/token-kinds.ts` | `lib/coderay/token_kinds.rb` (the token-kind table, entry for entry) |
| `src/card/render/code-highlighting/index.ts` | `lib/coderay/encoders/html/output.rb` (the DIV template) and `lib/coderay/scanners/scanner.rb` (`to_unix` newline normalization) |
| `src/card/render/code-highlighting/scanners/css.ts` | `lib/coderay/scanners/css.rb` |
| `src/card/render/code-highlighting/scanners/html.ts` | `lib/coderay/scanners/html.rb` |
| `src/card/render/code-highlighting/scanners/java-script.ts` | `lib/coderay/scanners/java_script.rb` |
| `src/card/render/code-highlighting/scanners/json.ts` | `lib/coderay/scanners/json.rb` |
| `src/card/render/code-highlighting/scanners/ruby.ts` | `lib/coderay/scanners/ruby.rb`, `lib/coderay/scanners/ruby/patterns.rb`, `lib/coderay/scanners/ruby/string_state.rb` |

CodeRay is MIT, "Copyright (C) 2005-2012 Kornelius Kalnbach" per its
MIT-LICENSE (see LICENSE for the full terms). The ported modules carry that notice through
LICENSE in this directory and the CodeRay entry in NOTICE.
