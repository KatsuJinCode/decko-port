// A local, uncompressed source snapshot. Never creates a repository or publishes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {sourceExportModeEvidence,sourceExportPermissions} from '../platform/source-export-file.mjs';
import {assertTinyMceExportCustody} from './tinymce-export-custody.mjs';
import {materializeSourceSnapshot} from './source-snapshot.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const roots = [
  'src/', 'vendor/', 'fixtures/vendor/', 'deploy/migrations/', 'deploy/seed/', 'db/migrations/',
  'tools/dist/', 'tools/libsass/libsass/', 'reference-harness/runner/',
  'tools/migrate/',
  'third-party-source/tinymce-5.10.7/',
  'reference-harness/adapters/ts/', 'reference-harness/fixtures/synthetic-v1/',
  'reference-harness/fixtures/write-battery-v1/', 'tests/schema/',
];
const singles = new Set([
  'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.dist.json',
  'db/schema.sqlite.sql', 'vm-staging-server.mjs', 'configured-public-page-shell.mjs',
  'tools/vendor/build-uglify-harmony-static.mjs', 'tools/oracle/typescript-source-loader.mjs',
  'reference-harness/browser/lib/journey-provenance.mjs',
  'reference-harness/SPEC.md', 'reference-harness/NORMALIZATION-EVIDENCE.md',
  'tools/handover/smoke.mjs',
  'tools/handover/prepare-demo.mjs', 'tools/handover/verify-local-host.mjs',
  'docs/handover/MIGRATION.md', 'docs/migration-recovery.md',
  'docs/handover/README.md', 'docs/handover/PORT-SCOPE.md',
  'docs/handover/DIFFERENCES.md', 'docs/handover/NOTICE.md',
  'docs/handover/KNOWN-COMPARISON-FAILURE.md',
  'docs/handover/DEPLOYMENT.md', 'docs/handover/UNTESTED-INPUTS.md',
  'docs/handover/EVIDENCE.md',
  'tools/vendor/import-tinymce-source.mjs',
  // Build sources for shipped generated artifacts: the LibSass WebAssembly
  // module (vendor/libsass-wasm/), the native LibSass host program, the edge
  // asset snapshots (vendor/edge-*-snapshot.js) and the vendored asset sets.
  'tools/libsass/sassc-wasm.c', 'tools/libsass/build-wasm.mjs',
  'tools/libsass/sassc-stdin.c', 'tools/libsass/build-native.mjs', 'tools/libsass/native-cache.mjs',
  'tools/vendor/build-edge-asset-source-snapshot.mjs',
  'tools/assets/vendor-bootstrap-fonts.mjs', 'tools/assets/vendor-decko-coded.mjs',
  'tools/assets/vendor-fontawesome.mjs', 'tools/assets/vendor-html4-entities.mjs',
  'tools/assets/vendor-material-icons.mjs', 'tools/assets/vendor-mod-style-images.mjs',
  'reference-harness/fixtures/DECK-BUNDLE-PROVENANCE.md',
  'tools/oracle/typescript-transform-witness.mjs',
  'tools/platform/native-typescript-compiler.mjs', 'tools/platform/native-typescript-compiler.d.mts',
  'tools/typescript/typecheck.mjs',
  'scripts/demo-scratch-copy/demo-child-lifecycle.mjs',
]);
// Drive-letter paths that are reviewed synthetic inputs (test data and upstream
// examples), never a path on this project's machines. Each entry is the exact
// file and the exact token the drive-letter-path rule matches there; any other
// drive-letter path anywhere refuses the export. The machine-path rule has no
// exemptions.
export const syntheticDrivePaths = new Map(Object.entries({
  'src/server/multipart-form.ts': [String.raw`C:\dir`],
  'reference-harness/runner/test/applied-forms.test.mjs': ['C:/Ruby33'],
  'reference-harness/runner/test/mod-probes.test.mjs': ['C:/capture-host'],
  'reference-harness/runner/test/normalize.test.mjs': ['C:/${host}', 'C:/a.rb', 'C:/b.rb', 'C:/capture-host', 'C:/other'],
  'reference-harness/runner/test/platform-command-paths.test.mjs': ['C:/Program', 'C:/fixture', String.raw`C:\\fixture`],
  'reference-harness/runner/test/platform-shell.test.mjs': [String.raw`C:\\Windows`, 'D:/Programs', 'D:/Tools', 'D:/User', 'D:/missing', String.raw`D:\\Programs`],
  'third-party-source/tinymce-5.10.7/upstream/modules/polaris/src/test/ts/atomic/api/RegexesTest.ts': ['h://foo.com'],
  'third-party-source/tinymce-5.10.7/upstream/modules/tinymce/src/plugins/paste/test/ts/browser/PasteTest.ts': ['C:/somelocation'],
}).map(([file, tokens]) => [file, new Set(tokens)]));
export function scan(bytes, file) {
  // No binary/size exemption. UTF-16 content receives a separate decoded scan,
  // and gzip content (a .gz name or the gzip magic bytes) is decompressed and
  // scanned the same way; gzip bytes that cannot be decompressed refuse.
  const text = bytes.toString('utf8'), findings = [];
  const views = [['utf8', text, file + '\n'], ['utf16le', bytes.toString('utf16le'), '']];
  if (file.toLowerCase().endsWith('.gz') || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    let inflated = null;
    try { inflated = gunzipSync(bytes); } catch { findings.push({ path: file, rule: 'unreadable-gzip', line: 0, encoding: 'gzip' }); }
    if (inflated) views.push(['gzip-utf8', inflated.toString('utf8'), ''], ['gzip-utf16le', inflated.toString('utf16le'), '']);
  }
  const rules = [
    ['private-identity', /\b(?:brandon\w*|culturesmith\w*|jpswi|Julian|KatsuJinCode|campletters\w*)\b/gi],
    ['machine-path', /[A-Za-z]:[\\/]+(?:Users|localProjects)[\\/][^\s"'<>]+/gi],
    // Any Windows drive-letter path: a drive letter not preceded by a letter,
    // digit or backslash (so URL schemes such as https:// and regex escapes such
    // as \w:\- do not match), one or more separators (so the JSON-escaped forms
    // C:\\dir and C:\/dir match too), then a path segment of at least two
    // characters.
    ['drive-letter-path', /(?<![A-Za-z0-9\\])[A-Za-z]:[\\/]+[\w$~.-][^\s"'`<>\\/:*?|]+/g],
    // Internal tracker ids (ACT-123, DECKO-123 and the other internal trackers).
    ['tracker-id', /\b(?:ACT|DECKO|ROW|FD|OPS)-\d+\b/g],
    // Governance wording about who decided what, which belongs in private records.
    ['ruling-phrase', /\b(?:operator|lead)(?:['’]s|s['’])?\s+(?:decision|ruling)\b|\brecorded\s+verbatim\b|\bexplicitly\s+overruled\b/gi],
    // Card names from private decks.
    ['private-deck-name', /\bHBQ\b|\bZQVT\b|\b[Mm]artial\s+[Cc]oncordance\b|\bCM\s?20\d+|\bBasicCs\b|\bAdminu\b/g],
    // Install paths on this project's own hosts, and the name of its private host.
    ['host-path', /\/opt\//g],
    ['private-host', /\bjuc\s+VM\b/gi],
    // Card and file ids from private decks, as whole tokens.
    ['private-card-id', /\b(?:45514|50617|20616|22747|22749|38274|34843)\b/g],
    ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    ['service-token', /\b(?:sk-or-v1-[\w-]{16,}|gh[pousr]_[\w]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[\w-]{10,})/g],
    ['known-secret', /55213f71[\w-]*/g],
    ['bearer-literal', /\bBearer\s+[A-Za-z0-9_-]{30,}/g],
    ['operator-quote', /(?:operator|user)\s+(?:said|ordered|demanded)\s*[:"“]/gi],
  ];
  for(const [encoding,decoded,prefix] of views)for (const [rule, pattern] of rules) {
    let line=1, previous=0;
    for (const match of (prefix + decoded).matchAll(pattern)) {
      if (rule === 'drive-letter-path' && syntheticDrivePaths.get(file)?.has(match[0])) continue;
      const offset = Math.max(0, match.index - prefix.length);
      for(let cursor=previous;cursor<offset;cursor++)if(decoded.charCodeAt(cursor)===10)line++;
      previous=offset;
      findings.push({ path: file, rule, line, encoding });
    }
  }
  return findings;
}
// Deck-local mods (src/card/mod-loader/deployment-deck-local-mods.ts) port a
// deck's own unpublished Ruby files, not upstream gem sources, so RUBY-MAP
// lists none of their Ruby citations.
export const deckLocalModSources = new Set(['src/card/mod-loader/mods/class-sections.ts']);
// Development-only Ruby files (oracle captures, probes, scratch scripts) are
// not part of the package, so RUBY-MAP names them generically instead of
// citing a path the reader cannot open. Upstream Decko gem citations stay.
export const developmentProbeCitation = 'development probe (not included)';
// Ruby files under the port's own development directories (oracle captures in
// tests/, trace scripts in tools/) are development-only unless the export
// selects them; upstream gem citations never start with these directories.
const portDevelopmentRubyRoots = /^(?:tests|tools|benchmarks|prototype|reference-harness|scripts)\//;
export function isDevelopmentOnlyRubyCitation(ref) {
  const citedPath = ref.replace(/:[\d-]+$/, '').replace(/^\.\//, '');
  return /(^|\/)(tmp|ruby-oracles|tools\/oracle)\//.test(citedPath) || /-probe\.rb$/.test(citedPath)
    || (portDevelopmentRubyRoots.test(citedPath) && !selected(citedPath));
}
/** The Ruby file citations RUBY-MAP lists for one TypeScript source. */
export function rubyReferences(file, text) {
  if (deckLocalModSources.has(file)) return [];
  const refs = text.match(/[\w./-]+\.rb(?::[\d-]+)?/g) || [];
  return [...new Set(refs.map(ref => isDevelopmentOnlyRubyCitation(ref) ? developmentProbeCitation : ref))];
}
export function selected(file) { return file!=='tools/migrate/IMPORT_DECK_RECIPE.md' && !file.split('/').includes('withheld') && (singles.has(file) || roots.some(prefix => file.startsWith(prefix))); }
export function stripCodeComments(content) {
  const code = [...content.keys()].filter(file => /.(?:ts|mts|js|mjs|sql)$/.test(file));
  const stage = mkdtempSync(path.join(os.tmpdir(), 'decko-export-strip-'));
  try {
    for (const file of code) {
      mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      writeFileSync(path.join(stage, file), content.get(file));
    }
    execFileSync(process.execPath, [path.join(root, 'tools/release/strip-comments.mjs'), '--write', '--root', stage], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    for (const file of code) content.set(file, readFileSync(path.join(stage, file)));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function main() {
  const output = path.resolve(root, process.argv[2] || 'tmp/handover-package');
  const rel = path.relative(path.resolve(root, 'tmp'), output);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('output must be below this checkout tmp/');
  const modeEvidence=sourceExportModeEvidence();
  const trackedEntries=git('ls-files','--stage','-z').split('\0').filter(Boolean).map(record=>{
    const separator=record.indexOf('\t');if(separator<0)throw Error('invalid source index record');
    const file=record.slice(separator+1),[mode,oid,stage]=record.slice(0,separator).split(' ');
    if(stage!=='0'&&selected(file))throw Error('unmerged selected source index entry: '+file);
    return {file,mode,oid};
  });
  const tracked=trackedEntries.map(entry=>entry.file);
  const modes=new Map(trackedEntries.map(entry=>[entry.file,entry.mode]));
  const sourceDirty = git('status','--porcelain','--untracked-files=no').trim() !== '';
  if(sourceDirty && !process.argv.includes('--allow-dirty'))throw Error('commit the intended source first; an exploratory export requires --allow-dirty and is marked dirty');
  const engineArgument=process.argv.indexOf('--engine-commit');
  const engineCommit=engineArgument<0?null:process.argv[engineArgument+1];
  if(engineCommit!==null){if(!/^[a-f0-9]{40}$/.test(engineCommit??''))throw Error('engine pin must be an exact full commit');git('merge-base','--is-ancestor',engineCommit,'HEAD');}
  const files = tracked.filter(selected).sort();
  const content = new Map();
  for (const file of files) {
    sourceExportPermissions(modes.get(file));
    if (!lstatSync(path.join(root, file)).isFile()) throw Error('non-regular source: ' + file);
    content.set(file, readFileSync(path.join(root, file)));
  }
  // Package-facing documents replace the private workspace's landing pages.
  for (const [from, to] of [['README.md','README.md'], ['PORT-SCOPE.md','PORT-SCOPE.md'], ['DIFFERENCES.md','DIFFERENCES.md'], ['NOTICE.md','NOTICE'], ['KNOWN-COMPARISON-FAILURE.md','KNOWN-COMPARISON-FAILURE.md'], ['DEPLOYMENT.md','DEPLOYMENT.md'], ['UNTESTED-INPUTS.md','UNTESTED-INPUTS.md'], ['EVIDENCE.md','EVIDENCE.md']]) {
    content.set(to, readFileSync(path.join(root, 'docs/handover', from)));
    modes.set(to,'100644');
  }
  const pkg = JSON.parse(content.get('package.json'));
  pkg.description = 'TypeScript derivative of Decko card 1.110.0 / decko 0.20.0. See PORT-SCOPE.md for evidence and limitations.';
  pkg.scripts = { 'build:engine': 'node tools/dist/build-engine.mjs', test: 'node tools/handover/smoke.mjs' };
  delete pkg.cloudflare;
  content.set('package.json', Buffer.from(JSON.stringify(pkg, null, 2) + '\n'));
  content.set('tsconfig.json', Buffer.from(JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noUncheckedIndexedAccess:false,esModuleInterop:true,skipLibCheck:true,forceConsistentCasingInFileNames:true,outDir:'dist',types:['node']},include:['src/**/*.ts','tests/schema/better-sqlite3.d.ts']},null,2)+'\n'));
  const map = ['# Ruby to TypeScript source map', '', 'Generated from the exact source snapshot. A citation identifies provenance, not proof of parity. Files without a Ruby citation are explicitly listed.', '', '| TypeScript module | Ruby references present in source |', '| --- | --- |'];
  for (const [file, bytes] of content) if (/^src\/.*\.ts$/.test(file)) {
    const refs = rubyReferences(file, bytes.toString('utf8'));
    const none = deckLocalModSources.has(file)
      ? 'Optional deck-local mod; it ports deck-local sources, not upstream Decko files, so no Ruby citation is listed.'
      : 'No Ruby file citation; inspect this module as port-specific or uncited implementation.';
    map.push(`| ${file} | ${refs.length ? refs.map(ref => ref === developmentProbeCitation ? ref : '`' + ref + '`').join(', ') : none} |`);
  }
  map.push('', '## Source difference annotation index', '',
    'The following index includes every source line carrying a divergence, unported, unsupported, or deliberate-difference marker under the stated matching rule. These are review references, not accepted exceptions or evidence that every possible difference is known. Read them with DIFFERENCES.md and the actual source.', '',
    'Matching rule: divergence word stem; unported word; not supported phrase; or deliberate/intentional followed by differ on the same line.', '',
    '| Source location | Review marker |', '| --- | --- |');
  for(const [file,bytes] of content)if(/^src\/.*\.ts$/.test(file)){
    const lines=bytes.toString('utf8').split('\n');
    lines.forEach((line,index)=>{if(/\bdivergen|\bunported\b|not supported|(?:deliberate|intentional).*differ/i.test(line))map.push(`| \`${file}:${index+1}\` | Source difference annotation; inspect the shipped module. |`);});
  }
  content.set('RUBY-MAP.md', Buffer.from(map.join('\n')+'\n'));
  modes.set('RUBY-MAP.md','100644');
  const tinyMceExportCustody=assertTinyMceExportCustody(content,modes);
  const metadata = { format: 1, sourceCommit: git('rev-parse','HEAD').trim(), engineCommit,
    historyIncluded: false, description: 'Local source snapshot; development Git history is excluded, not rewritten.',
    sourceDirty,
    fileModes:{source:'original Git index modes; generated documents are 100644',evidence:modeEvidence},tinyMceExportCustody,
  };
  stripCodeComments(content);
  const result = materializeSourceSnapshot({ output, content, modes, metadata, scanContent: scan });
  if (result.status !== 'blocked') {
    try {
      execFileSync(process.execPath, [path.join(root, 'tools/release/readiness-check.mjs'), output], { cwd: root, stdio: 'inherit', windowsHide: true });
      result.readiness = 'passed';
    } catch (error) {
      if (typeof error?.status !== 'number') throw error;
      result.readiness = 'refused';
      result.status = 'refused';
    }
  }
  console.log(JSON.stringify(result,null,2));
  if (result.status === 'blocked' || result.status === 'refused') process.exitCode=1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
