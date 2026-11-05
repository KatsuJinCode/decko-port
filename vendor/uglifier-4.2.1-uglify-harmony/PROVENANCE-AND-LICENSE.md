# PROVENANCE-AND-LICENSE.md — what this directory is

The byte-exact JavaScript compression engine for the `*all+*script` asset
compilation: the five vendored source files that
`uglifier-4.2.1` (rubygems) loads into ExecJS when a deck compiles its script
assets with `Uglifier.new(harmony: true).compile` — card-mod-script-0.20.0
`set/abstract/00_script.rb:25-27` (`try_compress`), the compression arm of
every `:compressed` script view.

Files, in uglifier's own load order (`uglifier.rb` `source_with`):

| file | bytes | role |
|---|---|---|
| `es5.js` | 8,938 | ES5 fallback shims uglifier injects for old runtimes |
| `split.js` | 4,755 | cross-browser String.prototype.split fallback |
| `source-map.js` | 100,453 | mozilla/source-map snapshot (MOZ_SourceMap) |
| `uglify-harmony.js` | 356,808 | the UglifyJS2 **harmony-branch** snapshot (mishoo/UglifyJS2, the 2.x-line harmony build uglifier 4.2.1 vendors — NOT npm `uglify-js` 3.x; no byte-compatible npm package exists) |
| `uglifier.js` | 1,212 | the `uglifier(options)` wrapper calling `UglifyJS.minify` |

Provenance: copied verbatim, unmodified, from the `lib/` directory of the
uglifier 4.2.1 gem from rubygems.org
(https://rubygems.org/gems/uglifier/versions/4.2.1), as used by Decko 0.20.0.

License, per file (each `LICENSE-*.txt` here is copied from the license text
exactly as the gem or the vendored file itself carries it):

| file | license where the file itself carries one | LICENSE file here |
|---|---|---|
| `uglify-harmony.js` | full BSD-2-Clause banner in-file (Mihai Bazon / UglifyJS2) | `uglify-harmony-js-LICENSE-BSD-2-Clause.txt` (the banner, verbatim) |
| `source-map.js` | no single header: the Mozilla Foundation notice (`BSD-3-Clause` per URL) heads the bundle's modules, and its Base 64 VLQ module (from Closure Compiler) carries the full BSD-3-Clause terms in-file | `source-map-js-LICENSE-NOTICES.txt` (both notices, verbatim) |
| `split.js` | in-file header names the MIT License (Steven Levithan) without stating its terms | `split-js-LICENSE-MIT.txt` (the header, verbatim, plus the standard MIT terms text) |
| `uglifier.js` | no license header | `uglifier-gem-LICENSE-MIT.txt` — the uglifier gem's own MIT license (`LICENSE.txt`, © Ville Lautanala; gemspec: `spec.license = "MIT"`), verbatim |
| `es5.js` | no license header | none — the gem ships it with no separate upstream license text; it is distributed here under the gem's MIT license (`uglifier-gem-LICENSE-MIT.txt`) |

The uglifier gem itself is MIT (`uglifier.gemspec` `spec.license = "MIT"`), and
its `LICENSE.txt` is the attribution text for the gem's own code (`uglifier.js`,
`lib/uglifier.rb`) and for the gem's distribution of the unheadered fragments
(`es5.js`). The upstream snapshots (`uglify-harmony.js`, `source-map.js`,
`split.js`) carry their own licenses above, preserved in-file. This file and
the `LICENSE-*.txt` texts are the attribution record.

How the files are checked: each vendored file is byte-identical to the file of
the same name in the `lib/` directory of the published uglifier 4.2.1 gem
(https://rubygems.org/gems/uglifier/versions/4.2.1). The build tool
`tools/vendor/build-uglify-harmony-static.mjs` pins the sha256 of each file and
refuses to build if any file differs from its pin:

| file | sha256 |
|---|---|
| `es5.js` | `2b07ae9bb832c97dd626abf842fa9eb679097d3d89247c14995025eb34edf945` |
| `split.js` | `a3bf0ca991071d83b773bc084731cc7d1b57c9076696c5236619f6ef61402c8b` |
| `source-map.js` | `6fe2072f87a800ca765308a4f1a9379276c388ca1ff22ab44e416f1c484763c4` |
| `uglify-harmony.js` | `f8fe16073c3f2ec536984d18cffade623bc399cfc2997353d6d919df14f8c1d0` |
| `uglifier.js` | `0a83872140a20fe90b176b6a7119fb36a746cec854421f42e12a3463ae619f1f` |

To check them yourself, unpack the published gem (`gem fetch uglifier -v 4.2.1`,
then `gem unpack uglifier-4.2.1.gem`) and compare the sha256 of each file in its
`lib/` directory with the table above.

Consumers: `src/card/assets/uglify-harmony-compile-engine.ts` (the vm loader)
and `src/card/assets/compiled-script-bundle.ts` (the compile contract). Node
only — the browser/worker bundle never imports these.
