import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { AdapterDiagnostics } from "./adapter-diagnostics.mjs";
import { PROFILE_ENV, PROFILE_EVENT, PROFILE_PREFIX, assessRuntimeProfile } from "./adapter-runtime-profile.mjs";

export function loadAdapterManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.command) || manifest.command.length === 0) {
    throw new Error(`${manifestPath}: "command" must be a non-empty array`);
  }
  return { ...manifest, dir: path.dirname(path.resolve(manifestPath)) };
}

export class AdapterSession {
  constructor(manifest, env, { timeoutMs = 120_000, log = () => {}, diagnosticsRoot, source = null, runtimeProfileContext = null } = {}) {
    this.manifest = manifest;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.runtimeProfileContext = runtimeProfileContext;
    this.runtimeProfileRecords = [];
    this.journal = new AdapterDiagnostics(diagnosticsRoot ?? path.resolve("tmp", "adapter-diagnostics"), {
      adapter: manifest.name ?? null, command: [...manifest.command], cwd: manifest.dir, source: source === null ? null : { ...source },
      work_directory: env.HARNESS_WORK ?? null,
    });
  }

  get diagnostics() { return this.journal.snapshot(); }
  get runtimeProfile() { return assessRuntimeProfile(this.runtimeProfileRecords, this.runtimeProfileContext, this.child?.pid); }

  capture(stream, chunk) {
    try { this.journal.append(stream, chunk); }
    catch (error) { this.captureError ??= error; this.kill(); }
  }

  persist(state) {
    try { this.journal.update(state); }
    catch (error) { this.captureError ??= error; }
  }

  processError(message) {
    const diagnostics = this.diagnostics;
    const error = new Error(`${this.captureError ? `Runner diagnostic capture failed: ${this.captureError.message}; ` : ""}${message}\nNative stderr decoded as UTF-8 (retained file ${diagnostics.streams.stderr.path}; capture complete: ${diagnostics.streams_complete}):\n` +
      readFileSync(diagnostics.streams.stderr.path).toString("utf8") +
      `\nRaw stdout/stderr paths, SHA-256 and process provenance: ${diagnostics.manifest}`);
    error.diagnostics = diagnostics;
    return error;
  }

  async start() {
    const command = [...this.manifest.command];
    const [cmd, ...args] = command;
    Object.assign(this.journal.provenance, { command, cwd: this.manifest.dir });
    this.child = spawn(cmd, args, {
      cwd: this.manifest.dir,
      env: { ...process.env, ...(this.manifest.env ?? {}), ...this.env,
        [PROFILE_ENV]: this.runtimeProfileContext ? JSON.stringify(this.runtimeProfileContext) : "" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.persist({ status: "running", pid: this.child.pid ?? null });
    this.child.on("error", error => { this.spawnError = error; });
    this.exited = new Promise((resolve) => this.child.on("exit", (code, signal) => resolve({ code, signal })));
    this.child.stdout.on("data", chunk => this.capture("stdout", chunk));
    this.child.stderr.on("data", chunk => this.capture("stderr", chunk));
    this.closed = new Promise(resolve => this.child.on("close", (code, signal) => {
      const state = { status: this.captureError ? "capture-failed" : this.spawnError ? "spawn-failed" : this.interruption ? "interrupted" : "exited",
        code, signal, interruption: this.interruption ?? null,
        spawn_error: this.spawnError ? { code: this.spawnError.code, message: this.spawnError.message } : null,
        capture_error: this.captureError?.message ?? null };
      try { this.journal.finish(state); } catch (error) { this.captureError ??= error; }
      resolve({ code, signal });
    }));
    this.closed.then(({ code, signal }) => {
      const message = this.spawnError ? `adapter spawn failed: ${this.spawnError.message}` : `adapter exited (code ${code}, signal ${signal})`;
      for (const { reject } of this.pending.values()) reject(this.processError(message));
      this.pending.clear();
    });
    const ready = new Promise((resolve, reject) => {
      this.onReady = resolve;
      this.closed.then(({ code, signal }) =>
        reject(this.processError(this.spawnError ? `adapter spawn failed: ${this.spawnError.message}` : `adapter exited (code ${code}, signal ${signal}) before ready`)),
      );
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.onLine(line));
    const diagnosticLines = createInterface({ input: this.child.stderr });
    diagnosticLines.on("line", line => {
      if (!line.startsWith(PROFILE_PREFIX)) return;
      let record;
      try { record = JSON.parse(line.slice(PROFILE_PREFIX.length)); }
      catch { record = { event: PROFILE_EVENT, problems: ["Malformed child profile JSON; original stderr retained"] }; }
      this.runtimeProfileRecords.push(record);
      this.persist({ runtime_profile: this.runtimeProfile });
    });
    try {
      this.hello = await withTimeout(ready, 600_000, "adapter did not become ready in 600 s");
      this.persist({ hello: this.hello, runtime_profile: this.runtimeProfile });
      if (this.hello.protocol !== 1) throw this.processError(`adapter speaks protocol ${this.hello.protocol}, runner speaks 1`);
      return this.hello;
    } catch (error) {
      this.persist({ startup_error: { name: error.name, message: error.message } });
      error.diagnostics ??= this.diagnostics;
      throw error;
    }
  }

  onLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      if (trimmed !== "") this.log(`adapter stdout (not protocol; full decoded UTF-8 line, original bytes in ${this.diagnostics.streams.stdout.path}): ${line}`);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.log(`adapter stdout (bad JSON; full decoded UTF-8 line, original bytes in ${this.diagnostics.streams.stdout.path}): ${line}`);
      return;
    }
    if (msg.ready === true && this.onReady) {
      this.onReady(msg);
      this.onReady = undefined;
      return;
    }
    const waiter = this.pending.get(msg.id);
    if (!waiter) {
      this.log(`adapter answered unknown id ${msg.id}`);
      return;
    }
    this.pending.delete(msg.id);
    waiter.resolve(msg);
  }

  request(body) {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return this.closed.then(() => { throw this.processError(`adapter has exited (code ${this.child.exitCode})`); });
    }
    const id = this.nextId++;
    const msg = { id, ...body };
    const answer = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(JSON.stringify(msg) + "\n");
    return withTimeout(answer, this.timeoutMs, TIMED_OUT).then(result => {
      this.persist({ last_request: { id, op: body.op, ok: result.ok } });
      return result;
    }).catch((error) => {
      this.pending.delete(id);
      if (error.message !== TIMED_OUT) throw error;
      this.persist({ last_request: { id, op: body.op, timed_out: true } });
      return { id, ok: false, error: { class: "HarnessTimeout", message: `request ${id} (${body.op}) timed out` }, diagnostics: this.diagnostics };
    });
  }

  async close() {
    if (!this.child) {
      if (!this.journal.state.finished) this.journal.finish({ status: "not-started", code: null, signal: null });
      return;
    }
    if (this.child.exitCode !== null || this.child.signalCode !== null || this.spawnError) {
      await this.closed;
      if (this.captureError) throw this.captureError;
      return;
    }
    this.child.stdin.write(JSON.stringify({ op: "quit" }) + "\n");
    this.child.stdin.end();
    const done = await Promise.race([this.closed, sleep(60_000).then(() => null)]);
    if (done === null) { this.interruption ??= "graceful shutdown did not finish"; this.kill(); }
    await this.closed;
    if (this.captureError) throw this.captureError;
  }

  async interrupt(reason) {
    if (this.journal.state.finished) return this.close();
    this.interruption = reason;
    this.persist({ status: "interrupting", interruption: reason });
    if (!this.child) return this.close();
    this.kill();
    await this.closed;
    if (this.captureError) throw this.captureError;
  }

  kill() {
    if (!this.child?.pid || this.child.exitCode !== null || this.child.signalCode !== null || this.killRequested) return;
    this.killRequested = true;
    this.interruption ??= "runner requested adapter termination";
    this.persist({ status: "interrupting", interruption: this.interruption });
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(this.child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } else {
      this.child.kill("SIGKILL");
    }
  }
}

const TIMED_OUT = "harness request timed out";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref();
    }),
  ]);
}
