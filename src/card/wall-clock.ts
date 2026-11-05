let captureWallClock: Date | undefined;

export function setCaptureWallClock(instant: Date | undefined): void {
  captureWallClock = instant;
}

export function cardWallClockNow(): Date {
  return captureWallClock ?? new Date();
}
