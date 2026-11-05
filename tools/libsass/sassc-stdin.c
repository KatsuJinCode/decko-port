/*
 * sassc-stdin: compile SCSS read from stdin with LibSass and write the CSS to
 * stdout, with the options SassC::Engine (sassc-ruby 2.4.0, lib/sassc/
 * engine.rb) passes for a string template and no options other than the
 * output style: a data context, no input path, no precision override (the
 * LibSass default), no include paths, no source comments, no source map.
 *
 *   sassc-stdin <nested|expanded|compact|compressed>  < in.scss  > out.css
 *
 * Exit status 0 on success; 1 with LibSass's error message on stderr when
 * the compile fails. An empty input renders as empty output, as
 * SassC::Engine#render returns `@template.dup` for an empty template.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "sass/context.h"

static char *read_all(FILE *in, size_t *len) {
  size_t cap = 1 << 20, n = 0;
  char *buf = (char *)malloc(cap + 1);
  if (!buf) return NULL;
  for (;;) {
    size_t got = fread(buf + n, 1, cap - n, in);
    n += got;
    if (n < cap) break;
    cap *= 2;
    char *next = (char *)realloc(buf, cap + 1);
    if (!next) { free(buf); return NULL; }
    buf = next;
  }
  buf[n] = '\0';
  *len = n;
  return buf;
}

int main(int argc, char **argv) {
  enum Sass_Output_Style style = SASS_STYLE_NESTED;
  if (argc > 1) {
    if (strcmp(argv[1], "expanded") == 0) style = SASS_STYLE_EXPANDED;
    else if (strcmp(argv[1], "compact") == 0) style = SASS_STYLE_COMPACT;
    else if (strcmp(argv[1], "compressed") == 0) style = SASS_STYLE_COMPRESSED;
    else if (strcmp(argv[1], "nested") != 0) {
      fprintf(stderr, "unknown style: %s\n", argv[1]);
      return 2;
    }
  }
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  size_t len = 0;
  char *source = read_all(stdin, &len);
  if (!source) { fprintf(stderr, "out of memory\n"); return 1; }
  if (len == 0) { free(source); return 0; }

  /* sass_make_data_context takes ownership of the source buffer. */
  struct Sass_Data_Context *data = sass_make_data_context(source);
  struct Sass_Context *ctx = sass_data_context_get_context(data);
  struct Sass_Options *opts = sass_context_get_options(ctx);
  sass_option_set_include_path(opts, "");
  sass_option_set_output_style(opts, style);

  int status = sass_compile_data_context(data);
  if (status != 0) {
    const char *msg = sass_context_get_error_message(ctx);
    fputs(msg ? msg : "compile failed", stderr);
    sass_delete_data_context(data);
    return 1;
  }
  const char *css = sass_context_get_output_string(ctx);
  if (css) fwrite(css, 1, strlen(css), stdout);
  sass_delete_data_context(data);
  return 0;
}
