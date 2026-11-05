# Stock jQuery UI smoothness theme images

Exact PNG bytes shipped in card-mod-style-0.20.0 public/jquery-ui-smoothness,
the files the gem's own stylesheet assets/style/jquery_ui_smoothness.css
references through url([[/mod/style/jquery-ui-smoothness/...]]) chunks once
the css format renders them. The original deployment serves them from the mod
public-files surface (the deck's public/mod/style/ tree, a copy of the gem's
public/ directory, served before the router sees the request); a stock
Decko 0.20.0 install carries the same 11 files with the same SHA-256 hashes
in its public/mod/style/jquery-ui-smoothness/ directory.

The gem has no separate license file for these images: the MIT grant is the
theme file's own header (provenance.json records that file as licenseSource).
Recreate with
`node tools/assets/vendor-mod-style-images.mjs <absolute-card-mod-style-0.20.0-directory>`.
