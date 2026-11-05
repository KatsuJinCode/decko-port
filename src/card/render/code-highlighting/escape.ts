export function coderayEscape(input: string, tabWidth = 8): string {
  if (input.length === 0) return input;
  if (!/[\t"&><\x00-\x08\x0B-\x1F]/.test(input)) return input;
  const tabReplacement = " ".repeat(tabWidth);
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    const ch = input[i];
    if (ch === "&") out += "&amp;";
    else if (ch === '"') out += "&quot;";
    else if (ch === ">") out += "&gt;";
    else if (ch === "<") out += "&lt;";
    else if (ch === "\t") out += tabReplacement;
    else if (c <= 0x08 || (c >= 0x0B && c <= 0x1F)) out += " ";
    else out += ch;
  }
  return out;
}
