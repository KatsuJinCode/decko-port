import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

export class AdapterDiagnostics {
  constructor(root, provenance) {
    mkdirSync(root, { recursive: true });
    this.directory = mkdtempSync(path.join(path.resolve(root), "session-"));
    this.manifestPath = null;
    this.previousManifestPath = null;
    this.nextGeneration = 0;
    this.publishedGeneration = null;
    this.provenance = provenance;
    this.state = { status: "created", streams_complete: false, started: new Date().toISOString(), finished: null };
    this.streams = {};
    try {
      for (const name of ["stdout", "stderr"]) {
        const file = path.join(this.directory, `${name}.bin`);
        this.streams[name] = { path: file, fd: openSync(file, "wx"), observed: 0, bytes: 0, hash: createHash("sha256") };
      }
      this.persist();
    } catch (error) {
      for (const stream of Object.values(this.streams)) closeSync(stream.fd);
      throw error;
    }
  }

  append(name, chunk) {
    const stream = this.streams[name];
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stream.observed += bytes.length;
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(stream.fd, bytes, offset, bytes.length - offset);
      if (written === 0) throw new Error(`No progress retaining adapter ${name} bytes`);
      stream.hash.update(bytes.subarray(offset, offset + written));
      stream.bytes += written;
      offset += written;
    }
  }

  snapshot(state = this.state) {
    return {
      format: "decko-adapter-diagnostics/1", manifest: this.manifestPath,
      previous_manifest: this.previousManifestPath, publication_generation: this.publishedGeneration,
      ...this.provenance, ...state,
      metadata_scope: state.streams_complete ? "final drained streams" : "checkpoint; stream files may contain later bytes",
      streams: Object.fromEntries(Object.entries(this.streams).map(([name, stream]) => [name, {
        path: stream.path, observed_bytes: stream.observed, retained_bytes: stream.bytes,
        sha256: stream.hash.copy().digest("hex"),
        content: name === "stdout" ? "original bytes, including protocol and nonprotocol output" : "original stderr bytes",
      }])),
    };
  }

  update(state) {
    const candidate = { ...this.state, ...state };
    try {
      this.persist(candidate);
      this.state = candidate;
    } catch (error) {
      this.state = { ...candidate, status: "capture-failed", streams_complete: false,
        capture_error: [candidate.capture_error, error.message].filter(Boolean).join("; "),
        manifest_publication_error: { code: error.code ?? null, message: error.message,
          attempted_manifest: this.lastPublicationAttempt } };
      throw error;
    }
  }
  persist(state = this.state) {
    const generation = this.nextGeneration++;
    const next = path.join(this.directory, `diagnostics-${String(generation).padStart(8,"0")}.json`);
    this.lastPublicationAttempt = next;
    const checkpoint = { ...this.snapshot(state), manifest: next,
      previous_manifest: this.manifestPath, publication_generation: generation };
    writeFileSync(next, JSON.stringify(checkpoint, null, 2) + "\n", { flag: "wx" });
    this.previousManifestPath = this.manifestPath;
    this.manifestPath = next;
    this.publishedGeneration = generation;
  }

  finish(state) {
    const errors = [];
    for (const stream of Object.values(this.streams)) {
      try { closeSync(stream.fd); } catch (error) { errors.push(error); }
    }
    const captureError = [state.capture_error ?? this.state.capture_error, ...errors.map(error => error.message)].filter(Boolean).join("; ");
    this.update({ ...state, ...(captureError ? { status: "capture-failed", capture_error: captureError } : {}),
      streams_complete: errors.length === 0 && !captureError,
      finished: new Date().toISOString() });
    if (errors.length) throw errors[0];
  }
}
