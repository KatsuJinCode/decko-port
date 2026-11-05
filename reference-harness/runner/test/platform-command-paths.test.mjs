import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const read = name => readFileSync(new URL('../../../' + name, import.meta.url), 'utf8');
const shell = { file: 'C:/Program Files/Git/bin/bash.exe', args: ['-c', "bundle exec ruby -e 'print RUBY_VERSION'"] };

test('local browser Ruby probe uses the platform-selected shell instead of PATH bash', () => {
  const source = read('reference-harness/browser/run-all.mjs');
  const expression = source.slice(source.indexOf('  const rubyVersion ='), source.indexOf('  const runtimeNote ='));
  const calls = [];
  const version = vm.runInNewContext(expression + '\nrubyVersion;', {
    referenceTarget: 'local', recordedRuntime: null, harness: '/fixture', path,
    process: { env: {} }, existsSync: () => false,
    harnessBashCommand: () => shell,
    spawnSync: (file, args, options) => { calls.push({ file, args, options }); return { status: 0, stdout: '3.4.11' }; },
  });
  assert.equal(version, '3.4.11');
  assert.equal(calls[0].file, shell.file);
  assert.equal(calls[0].options.windowsHide, true);
});

test('compatibility adapter launch uses the platform-selected shell and forward-slash script argv', async () => {
  const source = read('tools/compat-report/probe-deck.mjs');
  const functionSource = source.slice(source.indexOf('function adapterCreate('), source.indexOf('\nfunction baseClock('));
  const calls = [];
  const marker = new Error('captured launch');
  const adapter = vm.runInNewContext(functionSource + '\nadapterCreate;', {
    REPO: 'C:\\fixture', join: path.win32.join, slash: value => value.replaceAll('\\', '/'),
    process: { env: {} }, harnessBashCommand: args => ({ file: shell.file, args: args.map(value => value.replaceAll('\\', '/')) }),
    spawn: (file, args, options) => { calls.push({ file, args, options }); throw marker; },
  });
  await assert.rejects(adapter('deck', 'files', 'work', { card: 'fixture' }), error => error === marker);
  assert.equal(calls[0].file, shell.file);
  assert.equal(calls[0].args[0], 'C:/fixture/reference-harness/oracle/run-adapter.sh');
  assert.equal(calls[0].options.windowsHide, true);
});

test('Windows-only CPU benchmark refuses another host before launching PowerShell', () => {
  const modulePath = 'benchmarks/energy/platform-cpu.mjs';
  const source = read(existsSync(new URL('../../../' + modulePath, import.meta.url)) ? modulePath : 'benchmarks/energy/measure-cpu-ratio.mjs');
  const start = source.indexOf('function treeCpuMs(');
  const end = source.indexOf('\nasync function measure(');
  const functionSource = source.slice(start, end < 0 ? undefined : end);
  const calls = [];
  const counter = vm.runInNewContext(functionSource + '\ntreeCpuMs;', {
    process: { platform: 'linux' },
    assertCpuMeasurementPlatform: () => { const error = new Error('unsupported CPU measurement platform: linux'); error.name = 'UnsupportedCpuMeasurementPlatformError'; throw error; },
    execFileSync: (...args) => { calls.push(args); return '12'; },
  });
  assert.throws(() => counter(123), { name: 'UnsupportedCpuMeasurementPlatformError' });
  assert.equal(calls.length, 0);
});

test('Windows CPU counter rejects invalid identities and missing or invalid measurement output', () => {
  const source = read('benchmarks/energy/platform-cpu.mjs');
  const functionSource = source.slice(source.indexOf('function treeCpuMs('));
  let output = '';
  const calls = [];
  const counter = vm.runInNewContext(functionSource + '\ntreeCpuMs;', {
    assertCpuMeasurementPlatform: () => {},
    execFileSync: (...args) => { calls.push(args); return output; },
  });
  for (const pid of [0, -1, NaN, '1;exit', 1.5]) assert.throws(() => counter(pid), /positive process ID/);
  assert.equal(calls.length, 0);
  for (const invalid of ['', '  ', 'NaN', '-1']) {
    output = invalid;
    assert.throws(() => counter(123), /invalid measurement/);
  }
  output = '12.5\r\n';
  assert.equal(counter(123), 12.5);
  assert.equal(calls.at(-1)[2].windowsHide, true);
});
