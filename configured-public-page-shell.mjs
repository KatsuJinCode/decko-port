import {readFileSync} from 'node:fs';
import {validateHeaderName, validateHeaderValue} from 'node:http';
import {Parser, Tokenizer, parseDocument} from 'htmlparser2';

function maskAdditionalRawText(source) {
  const rawNames = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
  let rawName;
  const contexts = [];
  const activeContexts = [];
  let selfClosingToken = false;
  const svgIntegration = new Set(['foreignobject', 'desc', 'title']);
  const mathTextIntegration = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
  const mathTextExceptions = new Set(['mglyph', 'malignmark']);
  const parser = new Parser({
    onopentag(name, attributes) {
      const parent = activeContexts.at(-1);
      let namespace = parent?.namespace ?? 'html';
      if (namespace === 'html' || parent.htmlChildren || (parent.mathText && !mathTextExceptions.has(name)) || (parent.mathAnnotation && name === 'svg')) {
        namespace = name === 'svg' ? 'svg' : name === 'math' ? 'math' : 'html';
      }
      const context = {namespace,
        htmlChildren: (namespace === 'svg' && svgIntegration.has(name)) || (namespace === 'math' && name === 'annotation-xml' && ['text/html', 'application/xhtml+xml'].includes(attributes.encoding?.toLowerCase())),
        mathText: namespace === 'math' && mathTextIntegration.has(name),
        mathAnnotation: namespace === 'math' && name === 'annotation-xml',
        active: namespace === 'html' || !selfClosingToken,
      };
      contexts.push(context);
      if (context.active) activeContexts.push(context);
      if (namespace === 'html' && rawNames.has(name)) rawName = name;
    },
    onclosetag() { if (contexts.pop()?.active) activeContexts.pop(); },
  }, {Tokenizer: class extends Tokenizer {
    constructor(options, callbacks) {
      super(options, new Proxy(callbacks, {get(target, name) {
        const callback = target[name];
        if (name === 'onselfclosingtag') return end => {
          selfClosingToken = true;
          try { callback.call(target, end); } finally { selfClosingToken = false; }
        };
        return typeof callback === 'function' ? callback.bind(target) : callback;
      }}));
    }
  }});
  const pieces = [];
  let cursor = 0;
  while (cursor < source.length) {
    const delimiter = source.indexOf('>', cursor);
    const end = delimiter === -1 ? source.length : delimiter + 1;
    const chunk = source.slice(cursor, end);
    pieces.push(chunk);
    parser.write(chunk);
    cursor = end;
    if (rawName === undefined) continue;
    let close = source.length;
    if (rawName !== 'plaintext') {
      const closing = new RegExp(`<\\/${rawName}(?=[\\t\\n\\f\\r />])`, 'ig');
      closing.lastIndex = cursor;
      const match = closing.exec(source);
      if (match !== null) close = match.index;
    }
    const masked = ' '.repeat(close - cursor);
    pieces.push(masked);
    parser.write(masked);
    cursor = close;
    rawName = undefined;
  }
  parser.end();
  return pieces.join('');
}

function explicitRegion(source, node, tag) {
  if (!Number.isInteger(node.startIndex) || !Number.isInteger(node.endIndex)) return undefined;
  const start = source.indexOf('<', node.startIndex);
  if (start === -1 || start > node.endIndex || !new RegExp(`^<${tag}(?=[\\t\\n\\f\\r />])`, 'i').test(source.slice(start))) return undefined;
  const closeStart = source.lastIndexOf('</', node.endIndex);
  if (closeStart < start) return undefined;
  const closing = new RegExp(`^<\\/${tag}[\\t\\n\\f\\r ]*>`, 'i').exec(source.slice(closeStart));
  if (closing === null) return undefined;
  const end = closeStart + closing[0].length;
  return node.endIndex >= closeStart && node.endIndex < end ? {start, end} : undefined;
}

export function readPublicPageShellConfig(file, {footerVersionPin} = {}) {
  if (!file) return null;
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1) throw Error('UnsupportedPublicPageShellVersion');
  for (const tag of ['header', 'footer']) {
    if (typeof config[tag] !== 'string' || !new RegExp(`^<${tag}\\b[\\s\\S]*<\\/${tag}>$`, 'i').test(config[tag])) throw Error(`InvalidPublicPageShell:${tag}`);
  }
  if (!config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers)) throw Error('InvalidPublicPageShell:headers');
  for (const [name, value] of Object.entries(config.headers)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || typeof value !== 'string') throw Error('InvalidPublicPageShell:header-value');
    try { validateHeaderName(name); validateHeaderValue(name, value); }
    catch { throw Error('InvalidPublicPageShell:header-value'); }
  }
  return pinPublicPageShellFooterVersion(config, footerVersionPin);
}

export function pinPublicPageShellFooterVersion(config, pin) {
  if (pin === undefined || pin === '') return config;
  if (typeof pin !== 'string' || pin.trim() !== pin || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pin)) throw Error('InvalidPublicPageShellFooterVersion');
  return {...config, footer: config.footer.replace(/(>Decko v)\d+(?:\.\d+)+(?:-[a-z0-9.-]+)?(<\/a>)/gi, `$1${pin}$2`)};
}

export function applyConfiguredPublicPageShell(response, {config, method, signedIn}) {
  if (!config || method !== 'GET' || signedIn || typeof response.body !== 'string') return response;
  const type = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  if (typeof type !== 'string' || type.split(';', 1)[0].trim().toLowerCase() !== 'text/html') return response;
  const original = response.body;
  const document = parseDocument(maskAdditionalRawText(original), {withStartIndices: true, withEndIndices: true});
  const ranges = new Map();
  const protectedTags = new Set(['article', 'main', 'script', 'style', 'title', 'pre', 'textarea', 'xmp', 'plaintext', 'template', 'iframe', 'noembed', 'noframes', 'noscript', 'svg', 'math']);
  const pending = [document];
  while (pending.length !== 0) {
    const node = pending.pop();
    const name = node.name?.toLowerCase();
    if (protectedTags.has(name) || node.attribs?.role?.toLowerCase().split(/[\t\n\f\r ]+/).includes('main')) continue;
    if (name === 'header' || name === 'footer') {
      const range = explicitRegion(original, node, name);
      if (!ranges.has(name) && range !== undefined) ranges.set(name, range);
      continue;
    }
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
  let body = original;
  for (const [tag, range] of [...ranges].sort((a, b) => b[1].start - a[1].start)) {
    body = body.slice(0, range.start) + config[tag] + body.slice(range.end);
  }
  const headers = {...response.headers};
  for (const [name, value] of Object.entries(config.headers)) {
    for (const existing of Object.keys(headers)) if (existing.toLowerCase() === name) delete headers[existing];
    headers[name] = value;
  }
  if (body !== original) {
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-length') headers[name] = String(Buffer.byteLength(body));
  }
  return {...response, headers, body};
}
