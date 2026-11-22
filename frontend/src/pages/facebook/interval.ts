// Stored intervals have one-minute precision. Four decimals round-trip every saved value.
export function displayHours(minutes: number) {
  return Number((minutes / 60).toFixed(4));
}

export function toIntervalMinutes(hours: number) {
  return Math.round(hours * 60);
}
