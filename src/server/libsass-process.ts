import { memoizeScssCompiler, type ScssCompiler, type ScssOutputStyle } from "../card/assets/scss-compiler.js";

interface ChildProcessModule {
  spawn(
    command: string,
    args: readonly string[],
    options: { windowsHide: boolean; stdio: ["pipe", "pipe", "pipe"] },
  ): {
    stdin: { end(chunk: Uint8Array): void };
    stdout: { on(event: "data", cb: (chunk: Uint8Array) => void): void };
    stderr: { on(event: "data", cb: (chunk: Uint8Array) => void): void };
    on(event: "error", cb: (err: Error) => void): void;
    on(event: "close", cb: (code: number | null) => void): void;
  };
}

function childProcess(): ChildProcessModule {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const mod = proc?.getBuiltinModule?.("node:child_process") as ChildProcessModule | undefined;
  if (mod === undefined) throw new Error("the LibSass process compiler needs node:child_process");
  return mod;
}

export function libsassProcessCompiler(programPath: string): ScssCompiler {
  return memoizeScssCompiler((source: string, style: ScssOutputStyle) =>
    new Promise<string>((resolve, reject) => {
      if (source === "") return resolve("");
      const child = childProcess().spawn(programPath, [style], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Uint8Array[] = [];
      const err: Uint8Array[] = [];
      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", (c) => err.push(c));
      child.on("error", reject);
      child.on("close", (code) => {
        const text = (parts: Uint8Array[]) => new TextDecoder().decode(concat(parts));
        if (code === 0) resolve(text(out));
        else reject(new Error(`LibSass compile failed: ${text(err).trim() || `exit ${code}`}`));
      });
      child.stdin.end(new TextEncoder().encode(source));
    }));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
