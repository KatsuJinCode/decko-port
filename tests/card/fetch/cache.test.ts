// Unit tests for the two-level fetch cache port
// (src/card/fetch/cache.ts <- card-1.110.0 lib/card/cache.rb,
// cache/temporary.rb, cache/shared.rb). Every expectation cites the Ruby
// file/method it derives from.

import { describe, expect, it } from "vitest";
import {
  CardCache,
  DEFAULT_MAX_TEMPORARY_CACHE_KEYS,
  SharedCache,
  TemporaryCache,
  type SharedCacheStore,
} from "../../../src/card/fetch/cache.js";

function mapStore(): SharedCacheStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    read: (key) => map.get(key),
    write: (key, value) => map.set(key, value),
    delete: (key) => map.delete(key),
    exist: (key) => map.has(key),
  };
}

describe("TemporaryCache (lib/card/cache/temporary.rb)", () => {
  it("reads and writes a plain Hash (temporary.rb#read/#write)", () => {
    const temp = new TemporaryCache();
    expect(temp.read("a")).toBeUndefined();
    temp.write("a", 1);
    expect(temp.read("a")).toBe(1);
  });

  it("fetch computes on miss and stores, returns stored on hit (temporary.rb#fetch)", () => {
    const temp = new TemporaryCache();
    let computes = 0;
    const compute = () => {
      computes += 1;
      return `value-${computes}`;
    };
    expect(temp.fetch("k", compute)).toBe("value-1");
    expect(temp.fetch("k", compute)).toBe("value-1"); // hit: no recompute
    expect(computes).toBe(1);
  });

  it("treats a stored undefined (Ruby nil) as a HIT, not a miss (temporary.rb#exist?/#fetch)", () => {
    const temp = new TemporaryCache();
    temp.write("k", undefined);
    let computed = false;
    const result = temp.fetch("k", () => {
      computed = true;
      return "computed";
    });
    expect(computed).toBe(false);
    expect(result).toBeUndefined();
  });

  it("delete and reset clear entries (temporary.rb#delete/#reset)", () => {
    const temp = new TemporaryCache();
    temp.write("a", 1);
    temp.delete("a");
    expect(temp.exist("a")).toBe(false);
    temp.write("b", 2);
    temp.reset();
    expect(temp.exist("b")).toBe(false);
  });

  it("resets the whole store only when the REAL size exceeds maxKeys (temporary.rb#within_key_counts)", () => {
    const temp = new TemporaryCache(3);
    // reps overestimates: 3 writes to the SAME key -> reps=3 but size=1
    for (let i = 0; i < 3; i++) temp.write("same", i);
    expect(temp.read("same")).toBe(2); // NOT reset: recount (size=1) <= max
    // now push past the real cap
    temp.write("a", 1);
    temp.write("b", 2);
    temp.write("c", 3); // reps>=3 triggered a recount at write 4 -> size 4 > 3 -> reset
    temp.write("d", 4);
    expect(temp.read("same")).toBeUndefined();
    expect(temp.read("a")).toBeUndefined();
    expect(temp.read("d")).toBe(4);
  });

  it("defaults maxKeys to Cardio.config.max_temporary_cache_keys (cardio railtie.rb:41)", () => {
    expect(DEFAULT_MAX_TEMPORARY_CACHE_KEYS).toBe(10_000);
  });
});

describe("SharedCache (lib/card/cache/shared.rb)", () => {
  it("keys entries under {database}-{classKey}-{stamp}:{key} with a '/' before the key (shared.rb#full_key/#prefix)", () => {
    const shared = new SharedCache({ store: mapStore(), database: "decko", className: "Card" });
    // shared.rb#full_key: fk = "#{prefix}/#{key}" where prefix ends with ':'
    expect(shared.fullKey("some_key")).toMatch(new RegExp("^decko-Card-stamp-\\d+-\\d+:/some_key$"));
  });

  it("read/write/delete route through the full key (shared.rb#read/#write/#delete)", () => {
    const store = mapStore();
    const shared = new SharedCache({ store, database: "d", className: "C" });
    shared.write("k", "v");
    expect(shared.read("k")).toBe("v");
    expect([...store.map.keys()][0]).toContain("/k");
    shared.delete("k");
    expect(shared.read("k")).toBeUndefined();
  });

  it("reset rotates the stamp so old entries become unreachable (shared.rb#reset)", () => {
    const shared = new SharedCache({ store: mapStore() });
    shared.write("k", "old");
    const oldStamp = shared.stamp();
    shared.reset();
    expect(shared.stamp()).not.toBe(oldStamp);
    expect(shared.read("k")).toBeUndefined();
  });

  it("renew re-asserts the stamp/prefix from the registry (shared.rb#renew)", () => {
    const shared = new SharedCache({ store: mapStore() });
    shared.write("k", "v");
    shared.renew();
    expect(shared.read("k")).toBe("v"); // same stamp re-read from the registry
  });

  it("write_attribute/readAttribute mutate a cached object (shared.rb#write_attribute)", () => {
    const shared = new SharedCache({ store: mapStore() });
    shared.write("k", { name: "A" });
    shared.writeAttribute("k", "viewCacheKeys", ["x"]);
    expect(shared.readAttribute("k", "viewCacheKeys")).toEqual(["x"]);
  });

  it("fetch writes the computed value back on a miss (shared.rb#fetch / Rails store contract)", () => {
    const store = mapStore();
    const shared = new SharedCache({ store });
    const value = shared.fetch("k", () => 42);
    expect(value).toBe(42);
    expect(shared.read("k")).toBe(42);
  });
});

describe("CardCache (lib/card/cache.rb)", () => {
  it("read falls through temp -> shared and populates temp (cache.rb#read)", () => {
    const store = mapStore();
    const cache = new CardCache({ sharedStore: store, className: "Card" });
    cache.shared!.write("k", "shared-value");
    expect(cache.temp.read("k")).toBeUndefined();
    expect(cache.read("k")).toBe("shared-value");
    expect(cache.temp.read("k")).toBe("shared-value"); // copied into temp
  });

  it("write goes to BOTH shared and temp (cache.rb#write)", () => {
    const store = mapStore();
    const cache = new CardCache({ sharedStore: store });
    cache.write("k", "v");
    expect(store.map.size).toBe(1);
    expect(cache.temp.read("k")).toBe("v");
  });

  it("delete and reset touch both levels (cache.rb#delete/#reset)", () => {
    const store = mapStore();
    const cache = new CardCache({ sharedStore: store });
    cache.write("k", "v");
    cache.delete("k");
    expect(cache.exist("k")).toBe(false);
    cache.write("k2", "v2");
    cache.reset();
    expect(cache.exist("k2")).toBe(false);
  });

  it("without a shared store it behaves temp-only (cache.rb#initialize shared only when :store)", () => {
    const cache = new CardCache();
    expect(cache.shared).toBeUndefined();
    cache.write("k", "v");
    expect(cache.read("k")).toBe("v");
  });

  it("readMulti skips single-key calls like Ruby's with_multiple_keys (cache.rb:95-97)", () => {
    const cache = new CardCache();
    cache.write("a", 1);
    cache.write("b", 2);
    expect(cache.readMulti(["a"]).size).toBe(0); // size <= 1 -> {}
    const multi = cache.readMulti(["a", "b", "c"]);
    expect(multi.get("a")).toBe(1);
    expect(multi.get("b")).toBe(2);
    expect(multi.has("c")).toBe(false);
  });
});
