export const DEFAULT_REFRESH_INTERVAL_SECONDS = 86_400;

export const REFRESH_INTERVAL_OPTIONS = [
  { seconds: 3_600, label: "每小时" },
  { seconds: 21_600, label: "每 6 小时" },
  { seconds: 43_200, label: "每 12 小时" },
  { seconds: 86_400, label: "每天" },
  { seconds: 604_800, label: "每周" },
] as const;

const SELECTABLE_INTERVALS = new Set<number>(REFRESH_INTERVAL_OPTIONS.map(({ seconds }) => seconds));

export function isSelectableRefreshInterval(seconds: number, allowDisabled = false): boolean {
  return (allowDisabled && seconds === 0) || SELECTABLE_INTERVALS.has(seconds);
}

export function formatRefreshInterval(seconds: number): string {
  if (seconds === 0) return "不自动更新";
  if (seconds === 604_800) return "每周";
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "每天" : `每 ${days} 天`;
  }
  if (seconds % 3_600 === 0) return `每 ${seconds / 3_600} 小时`;
  if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`;
  return `每 ${seconds} 秒`;
}
