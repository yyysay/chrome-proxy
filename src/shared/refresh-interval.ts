export const PRESET_REFRESH_INTERVALS = [360, 720, 1_440, 10_080] as const;
export const MIN_REFRESH_INTERVAL_MINUTES = 1;
export const MAX_REFRESH_INTERVAL_MINUTES = 43_200;

export type RefreshUnit = "minute" | "hour" | "day";

export function isValidRefreshIntervalMinutes(value: number): boolean {
  return Number.isInteger(value) &&
    value >= MIN_REFRESH_INTERVAL_MINUTES && value <= MAX_REFRESH_INTERVAL_MINUTES;
}

export function normalizeRefreshIntervalMinutes(value: unknown, fallback = 1_440): number {
  const intervalMinutes = Number(value);
  return isValidRefreshIntervalMinutes(intervalMinutes) ? intervalMinutes : fallback;
}

export function legacyHoursToMinutes(value: unknown): number | undefined {
  const minutes = Number(value) * 60;
  return isValidRefreshIntervalMinutes(minutes) ? minutes : undefined;
}

export function formatRefreshInterval(intervalMinutes: number): string {
  if (intervalMinutes % 1_440 === 0) return `${intervalMinutes / 1_440} 天`;
  if (intervalMinutes % 60 === 0) return `${intervalMinutes / 60} 小时`;
  return `${intervalMinutes} 分钟`;
}

export function refreshUnitMultiplier(unit: RefreshUnit): number {
  return unit === "day" ? 1_440 : unit === "hour" ? 60 : 1;
}
