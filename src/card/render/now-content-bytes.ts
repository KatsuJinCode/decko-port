import { cardWallClockNow } from "../wall-clock.js";
import { deckTimeZoneName, formatCardDayofwkMinTz } from "../deck-time-zone.js";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function nowCardContent(): string {
  return formatCardDayofwkMinTz(cardWallClockNow(), deckTimeZoneName());
}
