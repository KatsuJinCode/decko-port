export interface VerifiedWasmAsset {
  url: string;
  byteLength: number;
  sha256: string;
}

export class WasmAssetLoadError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`WebAssembly asset ${code}: ${message}`, options);
    this.name = "WasmAssetLoadError";
  }
}

export async function loadVerifiedWasmAsset(
  asset: VerifiedWasmAsset,
  fetchAsset: typeof fetch = globalThis.fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  if (asset === null || typeof asset !== "object" || Array.isArray(asset)) {
    throw new WasmAssetLoadError("configuration", "expected a binary descriptor object");
  }
  let urlText: string;
  let expectedSha256: string;
  let expectedBytes: number;
  try {
    urlText = asset.url;
    expectedSha256 = asset.sha256;
    expectedBytes = asset.byteLength;
  } catch (cause) {
    throw new WasmAssetLoadError("configuration", "unreadable binary descriptor", { cause });
  }
  if (typeof urlText !== "string" || typeof expectedSha256 !== "string"
      || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0
      || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new WasmAssetLoadError("configuration", "expected scalar URL, SHA-256 and positive byte count");
  }
  let url: URL;
  try { url = new URL(urlText); }
  catch (cause) { throw new WasmAssetLoadError("configuration", "invalid URL", { cause }); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !url.pathname.endsWith(`/${expectedSha256}.wasm`)) {
    throw new WasmAssetLoadError("configuration", "expected an explicit HTTPS hash-addressed binary");
  }
  const signal = AbortSignal.timeout(10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchAsset(url.href, { redirect: "error", credentials: "omit", signal });
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      throw new WasmAssetLoadError("response", `unexpected status ${response.status} or redirect`);
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expectedBytes)) {
      await response.body?.cancel();
      throw new WasmAssetLoadError("length", "declared size differs from the pinned binary");
    }
    if (response.body === null) throw new WasmAssetLoadError("length", "missing response body");
    reader = response.body.getReader();
    const bytes = new Uint8Array(new ArrayBuffer(expectedBytes));
    let offset = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        throw new WasmAssetLoadError("length", "response exceeds the pinned binary size");
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== bytes.byteLength) throw new WasmAssetLoadError("length", "response ended before the pinned binary size");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actual = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
    if (actual !== expectedSha256) throw new WasmAssetLoadError("integrity", "SHA-256 differs from the pinned binary");
    return bytes;
  } catch (cause) {
    if (cause instanceof WasmAssetLoadError) throw cause;
    throw new WasmAssetLoadError("transport", "download failed or was interrupted", { cause });
  } finally {
    reader?.releaseLock();
  }
}
