# Third-party code inside the fixture decks' compiled asset bundles

The two reference-harness fixture decks store their compiled site script and
stylesheet as File cards, exactly as Decko stores a deck's `*all+*script` and
`*all+*style` outputs:

| Fixture deck file | What it is |
| --- | --- |
| `synthetic-v1/deck/files/307/1789819200.js` | compiled `*all+*script` output |
| `synthetic-v1/deck/files/447/1789819200.css` | compiled `*all+*style` output |
| `write-battery-v1/deck/files/307/1791633600.js` | compiled `*all+*script` output |
| `write-battery-v1/deck/files/447/1791633600.css` | compiled `*all+*style` output |

The two `.js` files are byte-identical (SHA-256
`53efb75374566e03e6d3fa7c179e888f100bb3545c4b724748128355c3f1c865`), and so
are the two `.css` files (SHA-256
`e9dbcbbb1bf1aa328e85804d5c2445fc8f9eb79247b7bf04687baece6256b2bb`), as each
fixture's `MANIFEST.json` records.

Each bundle is a concatenation, so the license files that sit beside the
vendored sources cannot sit beside these sections. This file maps every
third-party component in the bundles to its license text under
`fixtures/vendor/`. That tree ships in the same package, unmodified, and
`vendor/edge-script-source-snapshot.js` and `vendor/edge-style-source-snapshot.js`
embed the same license texts.

This record sits beside the fixture directories rather than inside
`deck/files/`: every file inside a fixture directory is part of that fixture's
pinned identity (`MANIFEST.json` digest), and `deck/files/` is copied as the
deck's file store when the harness runs.

## Script bundles (`307/*.js`)

Uglifier-compiled concatenation of the deck's script assets. The component
banners named below appear in the bundle.

| Component | Version | License | License text in this package |
| --- | --- | --- | --- |
| TinyMCE | 5.10.7 | **LGPL-2.1** (or Tiny commercial), "Copyright (c) Tiny Technologies, Inc." | `fixtures/vendor/mod-script-assets/card-mod-tinymce_editor/assets/script/License-lgpl-2.1.txt` (full LGPL-2.1 text) and `LICENSE.txt` beside it; complete corresponding source in `third-party-source/tinymce-5.10.7/` |
| Bootstrap Colorpicker | 2.5.2 | **Apache-2.0** | `fixtures/vendor/mod-script-assets/card-mod-bootstrap/vendor/bootstrap-colorpicker/LICENSE.txt` |
| Bootstrap (JavaScript) | 5.1.3 | MIT, "Copyright 2011-2021 The Bootstrap Authors" | `fixtures/vendor/mod-script-assets/card-mod-bootstrap/vendor/bootstrap/LICENSE.txt` |
| jQuery UI | 1.12.1 | MIT, "Copyright jQuery Foundation and other contributors" | `fixtures/vendor/mod-script-assets/card-mod-format/assets/script/jquery/LICENSE.txt`, section (1) |
| Autosize | 1.18.13 | MIT | same file, section (2) |
| jQuery UI Autocomplete HTML Extension | as vendored | MIT option of an MIT/GPL-2.0 dual license, "Copyright 2010, Scott González" | same file, section (3) |
| jQuery File Upload Plugin and its iframe transport | as vendored | MIT, "Copyright 2010, Sebastian Tschan" and "Copyright 2011, Sebastian Tschan" | `fixtures/vendor/mod-script-assets/card-mod-format/vendor/jquery_file_upload/LICENSE.txt` |

The rest of each script bundle is Decko's own mod code (compiled CoffeeScript
and JavaScript from the `card-mod-*` gems), GPL-3.0-or-later under the Decko
attribution in NOTICE.

## Stylesheet bundles (`447/*.css`)

SassC-compiled deck stylesheet.

| Component | Version | License | License text in this package |
| --- | --- | --- | --- |
| Bootstrap (Sass source) | 5.1.3 | MIT, "Copyright 2011-2021 The Bootstrap Authors" | `fixtures/vendor/bootstrap-scss/LICENSE.txt` |
| Bootstrap Icons (font CSS) | as vendored | MIT | `fixtures/vendor/mod-style-assets/card-mod-bootstrap/assets/style/LICENSE.txt` |
| Bootstrap Colorpicker (Sass) | 2.5.2 | **Apache-2.0** | `fixtures/vendor/mod-style-assets/card-mod-bootstrap/vendor/bootstrap-colorpicker/LICENSE.txt` |
| Select2 (CSS) | 4.x | MIT | `fixtures/vendor/mod-style-assets/card-mod-bootstrap/vendor/select2/LICENSE.txt` |
| Select2 Bootstrap 5 Theme | as vendored | MIT | `fixtures/vendor/mod-style-assets/card-mod-bootstrap/vendor/select2-bootstrap-5-theme/LICENSE.txt` |
| jQuery UI smoothness theme CSS | 1.12.1 | MIT, "Copyright jQuery Foundation and other contributors" (the theme file's own header, kept in the bundle) | the theme source `fixtures/vendor/mod-style-assets/card-mod-style/assets/style/jquery_ui_smoothness.css` carries the notice in its header; the full MIT text for the same copyright holder is section (1) of `fixtures/vendor/mod-script-assets/card-mod-format/assets/script/jquery/LICENSE.txt` |
| Bootswatch themes | as vendored | MIT, "Copyright (c) 2013 Thomas Park" | `fixtures/vendor/bootswatch/LICENSE` (applies where a Bootswatch theme's Sass is compiled in; no Bootswatch banner appears in these bundles) |

The stylesheets refer to the Bootstrap Icons and Material Icons fonts and the
jQuery UI theme images by URL; those files are not inside the bundles. Their
licenses are listed in NOTICE.

The rest of each stylesheet bundle is Decko's own mod Sass, GPL-3.0-or-later
under the Decko attribution in NOTICE.
