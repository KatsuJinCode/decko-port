export type ScssOutputStyle = "nested" | "expanded" | "compact" | "compressed";

export type ScssCompiler = (source: string, style: ScssOutputStyle) => Promise<string>;

export function memoizeScssCompiler(compile: ScssCompiler, maxEntries = 8): ScssCompiler {
  const memo = new Map<string, Promise<string>>();
  return (source, style) => {
    const key = `${style}\u0000${source}`;
    const known = memo.get(key);
    if (known !== undefined) {
      memo.delete(key);
      memo.set(key, known);
      return known;
    }
    const pending = compile(source, style);
    memo.set(key, pending);
    if (memo.size > maxEntries) {
      const oldest = memo.keys().next().value;
      if (oldest !== undefined) memo.delete(oldest);
    }
    pending.catch(() => {
      if (memo.get(key) === pending) memo.delete(key);
    });
    return pending;
  };
}
