export function envValue(name: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env !== "object") return undefined;
  return process.env[name];
}

export function debugFlag(name: string): boolean {
  return envValue(name) === "1";
}
