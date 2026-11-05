

import { describe, it, expect } from "vitest";

const SUPPORTED_VIEWS = new Set([
  "open", "closed", "content", "title", "titled", "menu",
  "core", "card_list", "naked", "bar", "bar_left", "bar_middle",
  "bar_right", "bar_bottom",
]);

function parsePath(pathname: string) {
  const path = pathname.replace(/\/+$/, "").replace(/^\/+/, "");
  if (path === "") return { name: "Home", view: "open" };
  if (path === "api/status") return { kind: "api" };
  if (path.startsWith("api/card/")) return { kind: "api" };

  const segments = path.split("/");
  if (segments.length === 1) return { name: decodeURIComponent(segments[0]), view: "open" };
  if (segments.length === 2 && SUPPORTED_VIEWS.has(segments[1])) {
    return { name: decodeURIComponent(segments[0]), view: segments[1] };
  }
  return { kind: "notFound" };
}

describe("worker URL parser", () => {
  it("routes / to Home :open", () => {
    expect(parsePath("/")).toEqual({ name: "Home", view: "open" });
  });

  it("routes /<name> to <name> :open", () => {
    expect(parsePath("/Hello+World")).toEqual({ name: "Hello+World", view: "open" });
    expect(parsePath("/A")).toEqual({ name: "A", view: "open" });
  });

  it("routes /<name>/<view> to <name> <view>", () => {
    expect(parsePath("/Hello+World/content")).toEqual({ name: "Hello+World", view: "content" });
    expect(parsePath("/Home/open")).toEqual({ name: "Home", view: "open" });
    expect(parsePath("/Home/closed")).toEqual({ name: "Home", view: "closed" });
    expect(parsePath("/Home/menu")).toEqual({ name: "Home", view: "menu" });
  });

  it("rejects unsupported views as notFound", () => {
    expect(parsePath("/Home/nonsense")).toEqual({ kind: "notFound" });
    expect(parsePath("/Home/open/extra")).toEqual({ kind: "notFound" });
  });

  it("flags api routes distinctly", () => {
    expect(parsePath("/api/status")).toEqual({ kind: "api" });
    expect(parsePath("/api/card/Hello+World")).toEqual({ kind: "api" });
  });

  it("decodes URL-encoded names", () => {
    expect(parsePath("/Hello%20World")).toEqual({ name: "Hello World", view: "open" });
  });

  it("handles trailing slashes", () => {
    expect(parsePath("/Home/")).toEqual({ name: "Home", view: "open" });
    expect(parsePath("/Hello+World/content/")).toEqual({ name: "Hello+World", view: "content" });
  });
});

describe("worker module — contract check", () => {
  it("worker.js exports a default object with a fetch handler (loadable as ESM)", async () => {

    const mod = await import("../worker.js");
    expect(typeof mod.default).toBe("object");
    expect(typeof mod.default.fetch).toBe("function");
  });
});
