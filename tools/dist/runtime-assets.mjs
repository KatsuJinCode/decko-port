import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const required = ['edge-bootstrap-scss-snapshot.js', 'edge-style-source-snapshot.js', 'edge-script-source-snapshot.js', 'libsass-wasm/libsass-3.6.4-wasm-base64.js', 'htmlentities-4.4.2/xhtml1.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function ordinaryDirectory(dir) {
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink() || path.resolve(realpathSync(dir)) !== path.resolve(dir)) throw Error('runtime asset directory is redirected: ' + dir);
}
function inventory(dir, optional = false) {
  if (optional && !existsSync(dir)) return [];
  ordinaryDirectory(dir);
  const files = [];
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name), name = prefix ? prefix + '/' + entry.name : entry.name, st = lstatSync(file);
      if (st.isSymbolicLink()) throw Error('runtime asset links are not permitted: ' + file);
      if (st.isDirectory()) walk(file, name);
      else if (st.isFile()) { const bytes = readFileSync(file); files.push([name, bytes.length, sha(bytes)]); }
      else throw Error('runtime asset is not a regular file: ' + file);
    }
  }
  walk(dir); return files;
}
function paths(repo) {
  const root = path.resolve(repo), source = path.join(root, 'vendor'), dist = path.join(root, 'dist');
  ordinaryDirectory(root);
  if (existsSync(dist)) ordinaryDirectory(dist);
  return { source, destination: path.join(dist, 'vendor') };
}
function sourceInventory(source) {
  const files = inventory(source), names = new Map(files.map(row => [row[0], row]));
  for (const name of required) if (!names.has(name) || names.get(name)[1] === 0) throw Error('required runtime asset source missing/empty: vendor/' + name);
  return files;
}
export function runtimeAssetReadiness(repo) {
  const { source, destination } = paths(repo), expected = sourceInventory(source), actual = new Map(inventory(destination, true).map(row => [row[0], row]));
  const gaps = [];
  for (const row of expected) {
    const found = actual.get(row[0]);
    if (!found || found[1] !== row[1] || found[2] !== row[2]) gaps.push('dist/vendor/' + row[0]);
    actual.delete(row[0]);
  }
  for (const name of actual.keys()) gaps.push('unexpected dist/vendor/' + name);
  return gaps;
}
export function copyRuntimeAssets(repo) {
  const { source, destination } = paths(repo), files = sourceInventory(source);
  inventory(destination, true);
  cpSync(source, destination, { recursive: true });
  const gaps = runtimeAssetReadiness(repo);
  if (gaps.length) throw Error('runtime asset distribution differs: ' + gaps.join(', '));
  return { files: files.length, bytes: files.reduce((n, row) => n + row[1], 0), manifestSha256: sha(JSON.stringify(files)) };
}
