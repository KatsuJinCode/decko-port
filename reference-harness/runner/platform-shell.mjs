import { existsSync } from 'node:fs';
import path from 'node:path';

export class UnsupportedHarnessShellPlatformError extends Error {
  name = 'UnsupportedHarnessShellPlatformError';
}

export function harnessBashCommand(args, {
  platform = process.platform, env = process.env, exists = existsSync,
} = {}) {
  if (!['win32', 'linux', 'darwin'].includes(platform)) {
    throw new UnsupportedHarnessShellPlatformError(`No harness Bash implementation for ${platform}`);
  }
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const candidates = env.HARNESS_BASH ? [env.HARNESS_BASH] : platform === 'win32'
    ? [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]
      .filter(Boolean).map(root => paths.join(root, 'Git', 'bin', 'bash.exe'))
      .concat(env.LOCALAPPDATA ? [paths.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')] : [])
    : ['/bin/bash', '/usr/bin/bash'];
  const file = candidates.find(candidate => paths.isAbsolute(candidate) && exists(candidate));
  if (!file) throw new Error(`No installed harness Bash found for ${platform}; set HARNESS_BASH to an absolute Bash executable`);
  return { file: platform === 'win32' ? file.replaceAll('\\', '/') : file, args: [...args] };
}
