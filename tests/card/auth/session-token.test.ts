// Unit tests for the session-token primitives: token shape (32 bytes / 64
// hex chars), sha256 digests against FIPS 180-4 test vectors, and the
// constant-time comparator's contract (result only depends on content, never
// throws on length mismatch, always processes the full inputs).

import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  generateSessionToken,
  SESSION_TOKEN_BYTES,
  sha256Hex,
  tokensEqual,
} from "../../../src/card/auth/session-token.js";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("generateSessionToken", () => {
  it("produces 32 bytes worth of hex (64 chars)", () => {
    expect(SESSION_TOKEN_BYTES).toBe(32);
    expect(generateSessionToken()).toMatch(HEX_64);
  });

  it("produces only lowercase hex characters", () => {
    expect(generateSessionToken()).toMatch(/^[0-9a-f]+$/);
  });

  it("produces distinct tokens across many draws", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateSessionToken());
    expect(tokens.size).toBe(1000);
  });
});

describe("sha256Hex", () => {
  // FIPS 180-4 / NIST test vectors for SHA-256.
  it("matches the empty-string vector", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the 'abc' vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("constantTimeEqual", () => {
  it("accepts equal buffers", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 4]))).toBe(true);
  });

  it("rejects a difference in the FIRST byte and in the LAST byte alike", () => {
    const base = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const diffFirst = new Uint8Array([9, 2, 3, 4, 5, 6, 7, 8]);
    const diffLast = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(constantTimeEqual(base, diffFirst)).toBe(false);
    expect(constantTimeEqual(base, diffLast)).toBe(false);
  });

  it("rejects length mismatch without throwing (pads the shorter)", () => {
    const shorter = new Uint8Array([1, 2, 3]);
    const longer = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(shorter, longer)).toBe(false);
    expect(constantTimeEqual(longer, shorter)).toBe(false);
  });

  it("treats two empty buffers as equal", () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe("tokensEqual", () => {
  it("compares strings through the constant-time path", () => {
    expect(tokensEqual("aaaa", "aaaa")).toBe(true);
    expect(tokensEqual("aaaa", "aaab")).toBe(false);
    expect(tokensEqual("aaaa", "aaa")).toBe(false);
  });
});
