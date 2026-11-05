export function rubyDefaultInspect(className: string, identity: number): string {
  return `#<${className}:0x${identity.toString(16).padStart(16, "0")}>`;
}

export function stableIdentity(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
