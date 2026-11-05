# Stock Bootstrap icon fonts

Exact WOFF and WOFF2 bytes shipped in card-mod-bootstrap0.20.0 public/fonts,
already referenced by that gem's bootstrap-icons.css and the compiled deck
stylesheet. These are the same bytes the existing Node public route serves.
Only the two missing edge font paths are added; no icon mapping/CSS is changed.

Bootstrap Icons upstream: https://github.com/twbs/icons (MIT). The upstream
LICENSE is retained verbatim in LICENSE.md. The gem snapshot's independent
upstream icon-font release number is not established; provenance.json pins
the gem version, exact file hashes/sizes and license source/hash instead of
inventing a version. Recreate with
`node tools/assets/vendor-bootstrap-fonts.mjs <absolute-card-mod-bootstrap-0.20.0-directory>`.
