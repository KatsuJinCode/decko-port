import { formatJsonFloat } from "./json-float-fpconv.js";

export function formatTagNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const token = JSON.stringify(value);
  if (!/[.e]/i.test(token)) return token;
  const negative = value < 0 ? "-" : "";
  const [coefficient, power] = Math.abs(value).toExponential().split("e");
  const digits = coefficient!.replace(".", "");
  const exponent = Number(power);
  const decimalPoint = exponent + 1;
  if (decimalPoint > 0 && decimalPoint < digits.length) {
    return `${negative}${digits.slice(0, decimalPoint)}.${digits.slice(decimalPoint)}`;
  }
  if (decimalPoint > 0 && decimalPoint <= 15) {
    return `${negative}${digits}${"0".repeat(decimalPoint - digits.length)}.0`;
  }
  if (decimalPoint <= 0 && decimalPoint > -4) {
    return `${negative}0.${"0".repeat(-decimalPoint)}${digits}`;
  }
  return `${negative}${digits[0]}.${digits.slice(1) || "0"}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

export function stringifyTagJsonNumbers(value: unknown): string | undefined {
  return JSON.stringify(value)?.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi,
    token => token.startsWith('"') || !/[.e]/i.test(token) ? token : formatJsonFloat(Number(token)));
}
