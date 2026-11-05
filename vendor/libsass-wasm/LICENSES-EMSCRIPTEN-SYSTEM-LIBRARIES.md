# Emscripten system libraries inside libsass-3.6.4-wasm-base64.js

**Status (2026-11-02): link list read from Emscripten 6.0.12's own link
rules; license texts ship in `licenses/`.** The libraries below are the ones
Emscripten 6.0.12 links by default for the flags this module was built with.
That list comes from the Emscripten source at tag `6.0.12`
(`tools/system_libs.py`, `get_libs_to_link`, and `src/settings.js`), read
against the build command in `tools/libsass/build-wasm.mjs`. It was not
checked against a link map of this exact build, and the SDK tree that built
the module was not re-opened; see "Not confirmed for this exact build" below.

## Why this note exists

The module in this directory is LibSass 3.6.4 (MIT, see `LICENSE` here)
compiled with Emscripten SDK 6.0.12 as a standalone WebAssembly module
(`-sSTANDALONE_WASM=1`; build recorded in `PROVENANCE.md`). The linker places
compiled parts of Emscripten's own system libraries into that module next to
LibSass: the C++ standard library and C++ ABI runtime that LibSass, a C++
program, needs, and the C library beneath them. Those parts carry their own
licenses, recorded here.

## Libraries Emscripten 6.0.12 links by default for this build

The build links with `em++` (so the C++ libraries are included), with
`-fwasm-exceptions`, `-sSTANDALONE_WASM=1` and `--no-entry`, and sets neither
`-sMALLOC` nor `-sEXIT_RUNTIME`. For those settings, Emscripten 6.0.12's link
rules add the following libraries:

| Library (Emscripten name) | Built from | License | Text shipped in `licenses/` |
| --- | --- | --- | --- |
| libc++ (`libc++`) | `system/lib/libcxx` | Apache-2.0 WITH LLVM-exception | `llvm-libcxx-LICENSE.TXT` |
| libc++abi (`libc++abi`) | `system/lib/libcxxabi` | Apache-2.0 WITH LLVM-exception | `llvm-libcxxabi-LICENSE.TXT` |
| libunwind (`libunwind`, added because of `-fwasm-exceptions`) | `system/lib/libunwind` | Apache-2.0 WITH LLVM-exception | `llvm-libunwind-LICENSE.TXT` |
| compiler-rt builtins (`libclang_rt.builtins`) | `system/lib/compiler-rt/lib/builtins` | Apache-2.0 WITH LLVM-exception | `llvm-compiler-rt-LICENSE.TXT` |
| musl libc parts of `libc`, and `libsockets` | `system/lib/libc/musl` | MIT | `musl-COPYRIGHT.txt` |
| Emscripten's own system code: the rest of `libc`, `libstandalonewasm`, `libnoexit`, `crt1_reactor` | `system/lib/libc`, `system/lib/pthread`, `system/lib/standalone` | MIT, or University of Illinois/NCSA, at the recipient's option | `emscripten-LICENSE.txt` |
| dlmalloc (`libmalloc`; `MALLOC` defaults to `"dlmalloc"`) | `system/lib/dlmalloc.c` | CC0 1.0 public domain dedication (stated in the file's header) | none needed |

One further license text ships because code from it may be compiled in:

| Library | Why it may be present | License | Text shipped in `licenses/` |
| --- | --- | --- | --- |
| LLVM libc headers | Emscripten 6.0.12 compiles libc++ with `system/lib/llvm-libc` on its include path, so header code from LLVM libc can become part of libc++. The separate `libllvmlibc` library is not linked by default. | Apache-2.0 WITH LLVM-exception | `llvm-libc-LICENSE.TXT` |

The source and tag of every shipped text are in `licenses/SOURCES.md`. Each
text is a verbatim copy whose Git blob hash equals the upstream file's at tag
`6.0.12`.

## What the module itself shows

Reading the module's bytes (it carries no symbol names) confirms part of the
list: it contains libc++ and libc++abi type names (for example
`St9exception`, `St12length_error`, `N10__cxxabiv...`), a WebAssembly
exception tag section, and WASI imports (`fd_write`, `environ_get` and
others) of the kind Emscripten's standalone libc makes.

## Not confirmed for this exact build

- The list above is what Emscripten 6.0.12's link rules add by default for
  these flags. No link map of this build was kept, so which objects from each
  library survived dead-code removal into the final module is not confirmed.
  A library on the list may contribute little or nothing.
- dlmalloc, compiler-rt and libunwind are not visible in the module's bytes
  (no symbol names); their presence follows from the link rules only.
- Whether any LLVM libc header code is in the module is not confirmed; its
  license ships as a precaution.
- The texts were taken from the Emscripten repository at tag `6.0.12`, on the
  assumption that the SDK `emsdk install latest` installed on 2026-10-08
  carries that tag's `system/lib` tree. The installed SDK's own files were not
  compared.

This note is not legal advice and does not state that any license obligation
has been reviewed or met.
