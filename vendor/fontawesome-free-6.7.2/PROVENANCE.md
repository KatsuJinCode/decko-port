# Font Awesome Free 6.7.2

Exact CSS and font bytes from the official `@fortawesome/fontawesome-free`
6.7.2 npm package. `provenance.json` records the tarball, npm SHA-512 integrity,
and each extracted file's SHA-256/size. `assets.js` packages these bytes for
Node and edge hosts without filesystem access; it does not modify the CSS or
fonts. Regenerate with `node tools/assets/vendor-fontawesome.mjs`.

Upstream: https://fontawesome.com and https://github.com/FortAwesome/Font-Awesome
Copyright Fonticons, Inc. The exact distributed `LICENSE.txt` is retained:
CSS code is MIT; fonts are SIL Open Font License 1.1; packaged icon artwork
is attributed under CC BY 4.0. No Pro assets or third-party Kit credentials
are included. This subset includes all CSS-referenced WOFF2 and TTF files.

Deployment mode `DECKO_FONT_AWESOME=local` replaces the stock private Kit
script with the local stylesheet. Unset/stock preserves the reference
profile's original output, including its recorded external dependency.
