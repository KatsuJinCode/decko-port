import type { SpawnSyncOptions, SpawnSyncOptionsWithBufferEncoding, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
export class NativeTypeScriptPlatformError extends Error {}
export function windowsNativeTypeScriptExecutable(directory: string): string;
export function linuxNativeTypeScriptExecutable(directory: string): string;
export function resolveInstalledNativeTypeScriptCompiler(root: string, platform?: string, architecture?: string): string;
export function spawnNativeTypeScript(root: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
export function spawnNativeTypeScript(root: string, args: readonly string[], options?: SpawnSyncOptionsWithBufferEncoding): SpawnSyncReturns<Buffer>;
export function spawnNativeTypeScript(root: string, args: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
