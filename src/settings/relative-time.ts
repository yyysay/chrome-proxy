export function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

export function timeAgeMs(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : Math.max(0, Date.now() - timestamp);
}

export function relativeTimeLabel(value?: string): string {
  const minutes = Math.floor(timeAgeMs(value) / 60_000);
  if (!Number.isFinite(minutes)) return "时间未知";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1_440)} 天前`;
}

export function setRelativeTimeStatus(
  element: HTMLElement,
  value: string,
  options: { baseClass: string; freshMinutes: number; staleMinutes: number },
): void {
  const minutes = Math.floor(timeAgeMs(value) / 60_000);
  const tone = minutes < options.freshMinutes ? "fresh" : minutes < options.staleMinutes ? "stale" : "error";
  const toneClass = tone === "fresh"
    ? "text-emerald-600 dark:text-[#30d158]"
    : tone === "stale"
      ? "text-amber-600 dark:text-[#ff9f0a]"
      : "text-red-600 dark:text-[#ff6961]";
  element.textContent = relativeTimeLabel(value);
  element.title = formatDateTime(value);
  element.dataset.statusTone = tone;
  element.className = `${options.baseClass} ${toneClass}`;
}
