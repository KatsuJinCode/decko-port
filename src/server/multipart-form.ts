export interface MultipartFilePart {
  kind: "file";
  name: string;
  filename: string;
  contentType: string | null;
  bytes: Uint8Array;
}

export interface MultipartTextPart {
  kind: "text";
  name: string;
  value: string;
}

export type MultipartPart = MultipartFilePart | MultipartTextPart;

const TEXT_PLAIN = "text/plain";

export function parseMultipartForm(body: Uint8Array, contentTypeHeader: string): MultipartPart[] {
  const boundary = boundaryOf(contentTypeHeader);
  if (boundary === null || boundary === "") {
    throw new Error("bad content body");
  }
  const text = Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("latin1");
  const delimiter = `--${boundary}`;
  const parts: MultipartPart[] = [];

  let pos = text.indexOf(delimiter);
  if (pos === -1) throw new Error("bad content body");
  pos += delimiter.length;

  while (true) {
    if (text.startsWith("--", pos)) break;
    if (text.startsWith("\r\n", pos)) pos += 2;
    const headEnd = text.indexOf("\r\n\r\n", pos);
    if (headEnd === -1) throw new Error("bad content body");
    const head = text.slice(pos, headEnd);
    const bodyStart = headEnd + 4;
    const nextBoundary = text.indexOf(`\r\n${delimiter}`, bodyStart);
    if (nextBoundary === -1) throw new Error("bad content body");
    const bodyEnd = nextBoundary;
    pos = nextBoundary + 2 + delimiter.length;

    const name = dispositionName(head);
    const filename = dispositionFilename(head);
    const contentType = headContentType(head);
    const partName = name !== undefined && name !== "" ? name : (filename ?? `${contentType ?? TEXT_PLAIN}[]`);

    if (filename !== undefined) {
      if (filename === "") continue;
      parts.push({
        kind: "file",
        name: partName,
        filename: basenameOfClientPath(filename),
        contentType,
        bytes: body.slice(bodyStart, bodyEnd),
      });
    } else {
      parts.push({
        kind: "text",
        name: partName,
        value: new TextDecoder("utf-8").decode(body.slice(bodyStart, bodyEnd)),
      });
    }
  }
  return parts;
}

function boundaryOf(contentTypeHeader: string): string | null {
  const match = /multipart\/.*?boundary\s*="?([^";,]+)"?/i.exec(contentTypeHeader);
  return match === null ? null : match[1];
}

function dispositionName(head: string): string | undefined {
  const match =
    /Content-Disposition:[^:]*;\s*name=("(?:\\"|[^"])*"|[^\s()<>,;:\\"/[\]?=]+)/i.exec(head);
  if (match === null) return undefined;
  return dequote(match[1]);
}

function dispositionFilename(head: string): string | undefined {
  const match =
    /Content-Disposition:\s*[^\s()<>,;:\\"/[\]?=]+\s*.*;\s*filename=("(?:\\"|[^"])*"|[^\s()<>,;:\\"/[\]?=]+)/i.exec(
      head,
    );
  if (match === null) return undefined;
  let filename = dequote(match[1]);
  if (!/\\[^\\"]/.test(filename)) {
    filename = filename.replace(/\\(.)/g, "$1");
  }
  return filename;
}

function dequote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function headContentType(head: string): string | null {
  const match = /Content-Type: (.*)\r\n/i.exec(head.endsWith("\r\n") ? head : `${head}\r\n`);
  return match === null ? null : match[1].trim();
}

function basenameOfClientPath(filename: string): string {
  const segments = filename.split(/[/\\]/);
  return segments[segments.length - 1];
}
