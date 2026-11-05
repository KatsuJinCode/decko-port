/*
 * sassc-wasm: the LibSass entry points the WebAssembly module exports, the
 * same compile SassC::Engine (sassc-ruby 2.4.0, lib/sassc/engine.rb) performs
 * for a string template: a data context, no input path, no precision override
 * (the LibSass default), no include paths, no source comments, no source map.
 *
 * The host (src/server/libsass-wasm.ts) writes the SCSS into the module's
 * heap, calls sassc_compile, and reads the result. style_code is the
 * Sass_Output_Style ordinal SassC maps its :style option to (0 nested,
 * 1 expanded, 2 compact, 3 compressed — the order of enum Sass_Output_Style
 * in sass/context.h). Returns 0 on success with *out_css set to a malloc'd
 * NUL-terminated CSS string, 1 on failure with *out_error set to a malloc'd
 * message; both are freed with the module's free export. LibSass compiles
 * with C++ exceptions internally; the module is built with exceptions
 * enabled (tools/libsass/build-wasm.mjs).
 *
 * An empty source is the caller's no-op (SassC::Engine#render returns the
 * empty template unchanged), mirroring sassc-stdin.c.
 */

#include <stdlib.h>
#include <string.h>
#include "sass/context.h"

__attribute__((export_name("sassc_compile")))
int sassc_compile(const char *source, int style_code, char **out_css, char **out_error) {
  enum Sass_Output_Style style = SASS_STYLE_NESTED;
  switch (style_code) {
    case 1: style = SASS_STYLE_EXPANDED; break;
    case 2: style = SASS_STYLE_COMPACT; break;
    case 3: style = SASS_STYLE_COMPRESSED; break;
    default: break;
  }

  /* sass_make_data_context takes ownership of the source buffer. */
  char *copy = strdup(source);
  if (copy == NULL) {
    *out_error = strdup("out of memory");
    return 1;
  }
  struct Sass_Data_Context *data = sass_make_data_context(copy);
  struct Sass_Context *ctx = sass_data_context_get_context(data);
  struct Sass_Options *opts = sass_context_get_options(ctx);
  sass_option_set_include_path(opts, "");
  sass_option_set_output_style(opts, style);

  int status = sass_compile_data_context(data);
  if (status != 0) {
    const char *msg = sass_context_get_error_message(ctx);
    *out_error = strdup(msg ? msg : "compile failed");
    *out_css = NULL;
    sass_delete_data_context(data);
    return 1;
  }
  /* The output string is owned by the context; copy before it is freed. */
  const char *css = sass_context_get_output_string(ctx);
  *out_css = strdup(css ? css : "");
  *out_error = NULL;
  sass_delete_data_context(data);
  return 0;
}
