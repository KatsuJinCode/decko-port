# Source of plugin.min.js

`plugin.min.js` in this directory is Decko's TinyMCE "nest" plugin (the `{{}}`
nest and `[[]]` link toolbar buttons). It is a verbatim copy of the file
upstream Decko distributes, and upstream Decko distributes this plugin only in
this form.

- Upstream file, at the release this project targets:
  https://github.com/decko-commons/decko/blob/v0.20.0/mod/tinymce_editor/public/plugins/nest/plugin.min.js
- The same file in the published gem: `public/plugins/nest/plugin.min.js` inside
  card-mod-tinymce_editor 0.20.0
  (https://rubygems.org/gems/card-mod-tinymce_editor/versions/0.20.0).
- SHA-256 `089c94a67f8f9862be068ec95010004c320105e1fc217b84f7b05a91a36ed6da`,
  1,207 bytes, for both the upstream file at the v0.20.0 tag and this copy
  (compared 2026-11-02).
- No unminified form exists upstream: the `mod/tinymce_editor/public/plugins/nest/`
  directory holds only `plugin.min.js` at the v0.20.0 tag and on the main
  branch (checked 2026-11-02), and no unminified copy exists in this project.
  The file is short and readable as it stands; it is the form upstream itself
  maintains and ships.

License: part of Decko, GPL-3.0-or-later, with the Decko attribution in NOTICE
at the repository root.
