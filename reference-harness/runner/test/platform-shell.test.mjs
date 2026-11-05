import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { harnessBashCommand } from '../platform-shell.mjs';
import { assertCpuMeasurementPlatform } from '../../../benchmarks/energy/platform-cpu.mjs';

test('Windows selects installed Git Bash without consulting PATH bash or WSL', () => {
  const inspected = [];
  const command = harnessBashCommand(['-c', 'printf "a\\nb"'], {
    platform: 'win32', env: { ProgramFiles: 'D:\\Programs', PATH: 'C:\\Windows\\System32' },
    exists: candidate => { inspected.push(candidate); return candidate === 'D:\\Programs\\Git\\bin\\bash.exe'; },
  });
  assert.equal(command.file, 'D:/Programs/Git/bin/bash.exe');
  assert.deepEqual(command.args, ['-c', 'printf "a\\nb"']);
  assert.deepEqual(inspected, ['D:\\Programs\\Git\\bin\\bash.exe']);
});

test('Windows supports per-user Git and an explicit absolute override', () => {
  const user = harnessBashCommand(['script'], { platform: 'win32', env: { LOCALAPPDATA: 'D:/User/Local' }, exists: () => true });
  assert.equal(user.file, 'D:/User/Local/Programs/Git/bin/bash.exe');
  const explicit = harnessBashCommand([], { platform: 'win32', env: { HARNESS_BASH: 'D:/Tools/bash.exe' }, exists: () => true });
  assert.equal(explicit.file, 'D:/Tools/bash.exe');
});

test('missing or relative explicit Bash refuses instead of falling back to PATH', () => {
  for (const [HARNESS_BASH, exists] of [['bash', () => true], ['D:/missing/bash.exe', () => false]]) {
    assert.throws(() => harnessBashCommand([], { platform: 'win32', env: { HARNESS_BASH }, exists }), /No installed harness Bash/);
  }
  assert.throws(() => harnessBashCommand([], { platform: 'win32', env: {}, exists: () => false }), /No installed harness Bash/);
});

test('Linux and macOS use their installed native Bash paths', () => {
  for (const platform of ['linux', 'darwin']) {
    const command = harnessBashCommand(['-c', 'printf ok'], { platform, env: {}, exists: candidate => candidate === '/bin/bash' });
    assert.equal(command.file, '/bin/bash');
    assert.deepEqual(command.args, ['-c', 'printf ok']);
  }
});

test('unsupported platforms refuse with a named shell error', () => {
  assert.throws(() => harnessBashCommand([], { platform: 'plan9' }), { name: 'UnsupportedHarnessShellPlatformError' });
});

test('CPU measurement explicitly admits Windows and refuses unsupported counters', () => {
  assert.doesNotThrow(() => assertCpuMeasurementPlatform('win32'));
  for (const platform of ['linux', 'darwin', 'plan9']) {
    assert.throws(() => assertCpuMeasurementPlatform(platform), { name: 'UnsupportedCpuMeasurementPlatformError' });
  }
});

test('resolved installed shell executes a hidden local command', () => {
  const command = harnessBashCommand(['-c', 'printf platform-shell-ok']);
  const result = spawnSync(command.file, command.args, { windowsHide: true, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'platform-shell-ok');
});
