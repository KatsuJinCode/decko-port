import { memoizeScssCompiler, type ScssCompiler, type ScssOutputStyle } from "../card/assets/scss-compiler.js";

interface LibsassExports {
  memory: WebAssembly.Memory;
  malloc(bytes: number): number;
  free(pointer: number): void;
  sassc_compile(source: number, style: number, outCss: number, outError: number): number;
  _initialize(): void;
}

const STYLE_CODES: Record<ScssOutputStyle, number> = { nested: 0, expanded: 1, compact: 2, compressed: 3 };

const EBADF = 8;

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(128).fill(255);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = i;
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 3) / 4)));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = table[clean.charCodeAt(i)];
    if (value === 255) throw new Error("libsass wasm module: invalid base64");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

function importObject(): WebAssembly.Imports {
  return {
    env: {
      emscripten_notify_memory_growth: () => {},
      __syscall_getcwd: (buffer: number, size: number) => {
        const path = new Uint8Array([0x2f, 0]);
        if (path.length > size) return -34;
        new Uint8Array(libsassExports!.memory.buffer).set(path, buffer);
        return path.length;
      },
      __syscall_getdents64: () => -EBADF,
    },
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => {
        throw new Error(`libsass wasm module called proc_exit(${code})`);
      },
      fd_close: () => EBADF,
      fd_read: (fd: number, iovs: number, iovsLength: number, nreadPointer: number) => {
        if (fd !== 0) return EBADF;
        new DataView(libsassExports!.memory.buffer).setUint32(nreadPointer, 0, true);
        return 0;
      },
      fd_write: (fd: number, iovs: number, iovsLength: number, nwrittenPointer: number) => {
        if (fd !== 1 && fd !== 2) return EBADF;
        const view = new DataView(libsassExports!.memory.buffer);
        let total = 0;
        for (let i = 0; i < iovsLength; i++) {
          total += view.getUint32(iovs + i * 8, true);
        }
        view.setUint32(nwrittenPointer, total, true);
        return 0;
      },
      fd_seek: () => EBADF,
      environ_sizes_get: (countPointer: number, sizePointer: number) => {
        const view = new DataView(libsassExports!.memory.buffer);
        view.setInt32(countPointer, 0, true);
        view.setInt32(sizePointer, 0, true);
        return 0;
      },
      environ_get: () => 0,
      random_get: (pointer: number, length: number) => {
        new Uint8Array(libsassExports!.memory.buffer).fill(0, pointer, pointer + length);
        return 0;
      },
    },
  };
}

let libsassExports: LibsassExports | undefined;
let libsassModule: Promise<LibsassExports> | undefined;

function instantiate(): Promise<LibsassExports> {
  libsassModule ??= (async () => {
    const { default: libsassWasmBase64 } = await import("../../vendor/libsass-wasm/libsass-3.6.4-wasm-base64.js");
    const source = libsassWasmBase64 as unknown as string | (() => Promise<Uint8Array<ArrayBuffer>>);
    const bytes = typeof source === "string" ? decodeBase64(source) : await source();
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, importObject());
    libsassExports = instance.exports as unknown as LibsassExports;
    libsassExports._initialize();
    return libsassExports;
  })().catch(error => {
    libsassModule = undefined;
    libsassExports = undefined;
    throw error;
  });
  return libsassModule;
}

function readCString(pointer: number): string {
  const bytes = new Uint8Array(libsassExports!.memory.buffer);
  let end = pointer;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(pointer, end));
}

export function libsassWasmCompiler(): ScssCompiler {
  return memoizeScssCompiler(async (source: string, style: ScssOutputStyle) => {
    if (source === "") return "";
    const ex = await instantiate();
    const sourceBytes = new TextEncoder().encode(source);
    const sourcePointer = ex.malloc(sourceBytes.length + 1);
    const resultPointer = ex.malloc(8);
    try {
      const before = new Uint8Array(ex.memory.buffer);
      before.set(sourceBytes, sourcePointer);
      before[sourcePointer + sourceBytes.length] = 0;
      const scratch = new DataView(ex.memory.buffer);
      scratch.setInt32(resultPointer, 0, true);
      scratch.setInt32(resultPointer + 4, 0, true);
      const status = ex.sassc_compile(sourcePointer, STYLE_CODES[style], resultPointer, resultPointer + 4);
      const after = new DataView(ex.memory.buffer);
      const cssPointer = after.getInt32(resultPointer, true);
      const errorPointer = after.getInt32(resultPointer + 4, true);
      if (status !== 0) {
        const message = errorPointer !== 0 ? readCString(errorPointer).trim() : "";
        throw new Error(`LibSass compile failed: ${message || `exit ${status}`}`);
      }
      return cssPointer !== 0 ? readCString(cssPointer) : "";
    } finally {
      const cleanup = new DataView(ex.memory.buffer);
      const cssPointer = cleanup.getInt32(resultPointer, true);
      const errorPointer = cleanup.getInt32(resultPointer + 4, true);
      if (cssPointer !== 0) ex.free(cssPointer);
      if (errorPointer !== 0) ex.free(errorPointer);
      ex.free(resultPointer);
      ex.free(sourcePointer);
    }
  });
}
