

import { describe, expect, it } from "vitest";
import {
  DATE_ERROR_CLASS_NAME,
  DateError,
  dateError,
  isValidDateContent,
} from "../../../src/card/render/errors.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("Date::Error — Date-type card parse failure (M4 sweep)", () => {

  it("class name is the Ruby literal 'Date::Error'", () => {
    expect(DateError.name).toBe(DATE_ERROR_CLASS_NAME);
    expect(DATE_ERROR_CLASS_NAME).toBe("Date::Error");
  });

  it("constructor.name matches the corpus sentinel's class prefix", () => {
    const err = dateError();
    expect(err.constructor.name).toBe("Date::Error");
    expect(err.name).toBe("Date::Error");
  });

  it("default message is the literal 'invalid date'", () => {
    const err = dateError();
    expect(err.message).toBe("invalid date");
  });

  it("isValidDateContent rejects random alphabetic content the corpus carries", () => {

    for (const content of ["brcvtwrvz", "kieqzamnqc", "iaqgzhboog", "gneyrpsuto", "hswzwafijw"]) {
      expect(isValidDateContent(content)).toBe(false);
    }
  });

  it("isValidDateContent rejects empty content", () => {
    expect(isValidDateContent("")).toBe(false);
  });

  it("isValidDateContent accepts common date formats JS understands", () => {

    expect(isValidDateContent("2023-01-15")).toBe(true);
    expect(isValidDateContent("January 15, 2023")).toBe(true);
  });

  it("rendering :open of a Date-type card with non-date content raises DateError", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 1135,
        name: "broken date one",
        typeId: 90,
        dbContent: "brcvtwrvz",
      });
      let captured: unknown;
      try {
        await storage.engine.render("broken_date_one", "open");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.constructor.name).toBe("Date::Error");
      expect(err.message).toBe("invalid date");
    } finally {
      storage.close();
    }
  });

  it("rendering :content of a Date-type card with non-date content raises DateError", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 1211,
        name: "broken date two",
        typeId: 90,
        dbContent: "iaqgzhboog",
      });
      let captured: unknown;
      try {
        await storage.engine.render("broken_date_two", "content");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err.constructor.name).toBe("Date::Error");
      expect(err.message).toBe("invalid date");
    } finally {
      storage.close();
    }
  });

  it("rendering :open of a Date-type card with valid ISO content does not raise", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 500,
        name: "good date",
        typeId: 90,
        dbContent: "2023-01-15",
      });
      const html = await storage.engine.render("good_date", "open");
      expect(typeof html).toBe("string");
      expect(html).toContain("good_date-open-view");
    } finally {
      storage.close();
    }
  });

  it("rendering :open of a Date-type card whose type card name is NOT 'Date' still raises DateError (corpus:1135 corpus-shaped fixture)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });

      await seedCard(storage, { id: 17, name: "evog", codename: "date", typeId: 2 });

      await seedCard(storage, {
        id: 1135,
        name: "brcvtwrvz card",
        typeId: 17,
        dbContent: "brcvtwrvz",
      });
      let captured: unknown;
      try {
        await storage.engine.render("brcvtwrvz_card", "open");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.constructor.name).toBe("Date::Error");
      expect(err.message).toBe("invalid date");
    } finally {
      storage.close();
    }
  });

  it("rendering :content of a Date-type card whose type card name is NOT 'Date' still raises DateError (corpus:1211 corpus-shaped fixture)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 17, name: "evog", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 1211,
        name: "iaqgzhboog card",
        typeId: 17,
        dbContent: "iaqgzhboog",
      });
      let captured: unknown;
      try {
        await storage.engine.render("iaqgzhboog_card", "content");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err.constructor.name).toBe("Date::Error");
      expect(err.message).toBe("invalid date");
    } finally {
      storage.close();
    }
  });

  it("rendering :closed and :title of a Date-type card with non-date content does NOT raise (corpus:1135 corpus shape)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 17, name: "evog", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 1135,
        name: "broken date card",
        typeId: 17,
        dbContent: "brcvtwrvz",
      });
      const closedHtml = await storage.engine.render("broken_date_card", "closed");
      expect(closedHtml).toContain("broken_date_card-closed-view");
      const titleHtml = await storage.engine.render("broken_date_card", "title");
      expect(typeof titleHtml).toBe("string");

      let openCaptured: unknown;
      try {
        await storage.engine.render("broken_date_card", "open");
      } catch (err) {
        openCaptured = err;
      }
      expect((openCaptured as Error)?.constructor.name).toBe("Date::Error");
      let contentCaptured: unknown;
      try {
        await storage.engine.render("broken_date_card", "content");
      } catch (err) {
        contentCaptured = err;
      }
      expect((contentCaptured as Error)?.constructor.name).toBe("Date::Error");
    } finally {
      storage.close();
    }
  });

  it("the raised error reproduces the exact CAPTURE_ERROR sentinel bytes the corpus:1135 capture recorded", () => {

    const err = dateError();
    const sentinel = `CAPTURE_ERROR: ${err.constructor.name}: ${err.message}`;
    expect(sentinel).toBe("CAPTURE_ERROR: Date::Error: invalid date");
  });
});
