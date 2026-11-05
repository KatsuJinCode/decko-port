export const DEFAULT_DECK_TIME_ZONE = "UTC";

export const RECORDED_HOST_TIME_ZONE = "America/Los_Angeles";

let deckTimeZone: string = DEFAULT_DECK_TIME_ZONE;

export function deckTimeZoneName(): string {
  return deckTimeZone;
}

export function setDeckTimeZone(zone: string | undefined): void {
  if (zone === undefined) {
    deckTimeZone = DEFAULT_DECK_TIME_ZONE;
    return;
  }
  const trimmed = zone.trim();
  if (trimmed.length === 0) {
    throw new Error(`setDeckTimeZone: the zone name is empty`);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  } catch {
    throw new Error(
      `setDeckTimeZone: "${trimmed}" is not a time zone this runtime knows. ` +
        `Pass an IANA zone name (e.g. "Europe/Berlin", "UTC").`,
    );
  }
  deckTimeZone = trimmed;
}

export function resetDeckTimeZone(): void {
  deckTimeZone = DEFAULT_DECK_TIME_ZONE;
}

export function zoneAbbreviation(instant: Date, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(instant);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function formatCardDayofwkMinTz(
  instant: Date,
  zone: string = deckTimeZone,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return (
    `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")} ` +
    `${get("hour")}:${get("minute")} ${get("dayPeriod")} ${zoneAbbreviation(instant, zone)}`
  );
}