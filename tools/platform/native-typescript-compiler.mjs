import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";

export class NativeTypeScriptPlatformError extends Error {
  name = "NativeTypeScriptPlatformError";
}

export function windowsNativeTypeScriptExecutable(directory) {
  const executable = path.join(directory, "lib", "tsc.exe");
  return executable.length >= 248 ? path.toNamespacedPath(executable) : executable;
}

export function linuxNativeTypeScriptExecutable(directory) {
  return path.join(directory, "lib", "tsc");
}

function packageMetadata(require, name) {
  try {
    const file = require.resolve(name + "/package.json");
    const metadata = JSON.parse(readFileSync(file, "utf8"));
    const version = metadata?.version;
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)
      || !Object.hasOwn(metadata, "version") || typeof version !== "string"
      || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
      throw Error("Expected a package object with a nonempty semantic version");
    }
    return { file, metadata };
  } catch (cause) {
    throw new NativeTypeScriptPlatformError("Installed TypeScript package is missing, unreadable or invalid: " + name, { cause });
  }
}

export function resolveInstalledNativeTypeScriptCompiler(root, platform = process.platform, architecture = process.arch) {
  const { file, metadata } = packageMetadata(createRequire(path.join(root, "package.json")), "typescript");
  const platformPackage = `@typescript/typescript-${platform}-${architecture}`;
  if (!Object.hasOwn(metadata.optionalDependencies ?? {}, platformPackage)) {
    throw new NativeTypeScriptPlatformError(`No declared native TypeScript package for ${platform}/${architecture}`);
  }
  const native = packageMetadata(createRequire(file), platformPackage);
  if (native.metadata.version !== metadata.version) {
    throw new NativeTypeScriptPlatformError("Installed native TypeScript version differs from its launcher package");
  }
  const directory = path.dirname(native.file);
  let executable;
  if (platform === "win32") executable = windowsNativeTypeScriptExecutable(directory);
  else if (platform === "linux") executable = linuxNativeTypeScriptExecutable(directory);
  else if (["darwin", "aix", "freebsd", "netbsd", "openbsd", "sunos"].includes(platform)) executable = linuxNativeTypeScriptExecutable(directory);
  else throw new NativeTypeScriptPlatformError(`Unsupported native TypeScript platform: ${platform}`);
  if (!existsSync(executable)) throw new NativeTypeScriptPlatformError(`Declared native TypeScript executable is missing: ${executable}`);
  return executable;
}

export function spawnNativeTypeScript(root, args, options = {}) {
  return spawnSync(resolveInstalledNativeTypeScriptCompiler(root), args, { ...options, windowsHide: true, shell: false });
}
