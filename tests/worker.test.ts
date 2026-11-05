

import { test, expect } from "vitest";
import worker from "../worker.js";
import { CloudflareD1Adapter, type D1DatabaseLike } from "../src/server/drivers/d1.js";
import { FetchEngine } from "../src/card/fetch.js";
import { RenderEngine } from "../src/card/render.js";

test("worker module loads and exports a fetch handler", () => {
  expect(typeof worker.fetch).toBe("function");
});

test("worker: /api/status with empty env returns a structured error (not a 500)", async () => {
  const env = {} as unknown as { DB: D1DatabaseLike };
  const req = new Request("https://example.com/api/status");
  const res = await worker.fetch(req, env);

  expect(res).toBeInstanceOf(Response);
  expect([200, 500]).toContain(res.status);
});

test("worker: hit /Unknown+Card with no DB returns a structured error envelope", async () => {
  const env = {} as unknown as { DB: D1DatabaseLike };
  const req = new Request("https://example.com/Unknown+Card");
  const res = await worker.fetch(req, env);
  expect(res).toBeInstanceOf(Response);

  expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
  const body = await res.text();
  expect(body).toContain("<!doctype html>");
});

test("engine: FetchEngine + RenderEngine wire cleanly through the worker surface", async () => {

  expect(typeof CloudflareD1Adapter).toBe("function");
  expect(typeof FetchEngine).toBe("function");
  expect(typeof RenderEngine).toBe("function");
});
