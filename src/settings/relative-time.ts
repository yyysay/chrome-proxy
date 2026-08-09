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
  const ageMs = timeAgeMs(value);
  if (!Number.isFinite(ageMs)) return "时间未知";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1_440)} 天前`;
}

function relativeToneClass(minutes: number, freshMinutes: number, staleMinutes: number): string {
  if (minutes < freshMinutes) return "text-emerald-600 dark:text-[#30d158]";
  if (minutes < staleMinutes) return "text-amber-600 dark:text-[#ff9f0a]";
  return "text-red-600 dark:text-[#ff6961]";
}

function relativeTone(minutes: number, freshMinutes: number, staleMinutes: number): "fresh" | "stale" | "error" {
  if (minutes < freshMinutes) return "fresh";
  if (minutes < staleMinutes) return "stale";
  return "error";
}

export function setRelativeTimeStatus(
  element: HTMLElement,
  value: string,
  options: {
    prefix?: string;
    baseClass: string;
    freshMinutes: number;
    staleMinutes: number;
    suffix?: string;
    staleSuffix?: string;
    hideWhenFresh?: boolean;
  },
): void {
  element.dataset.relativeTime = value;
  element.dataset.relativePrefix = options.prefix ?? "";
  element.dataset.relativeBaseClass = options.baseClass;
  element.dataset.relativeFreshMinutes = String(options.freshMinutes);
  element.dataset.relativeStaleMinutes = String(options.staleMinutes);
  element.dataset.relativeSuffix = options.suffix ?? "";
  element.dataset.relativeStaleSuffix = options.staleSuffix ?? "";
  element.dataset.relativeHideWhenFresh = String(options.hideWhenFresh === true);
  element.title = formatDateTime(value);
  refreshRelativeTimeElement(element);
}

export function clearRelativeTimeStatus(element: HTMLElement): void {
  for (const key of [
    "relativeTime", "relativePrefix", "relativeBaseClass", "relativeFreshMinutes",
    "relativeStaleMinutes", "relativeSuffix", "relativeStaleSuffix", "relativeHideWhenFresh",
  ]) delete element.dataset[key];
  element.removeAttribute("title");
}

function refreshRelativeTimeElement(element: HTMLElement): void {
  const value = element.dataset.relativeTime;
  if (!value) return;
  const minutes = Math.floor(timeAgeMs(value) / 60_000);
  const freshMinutes = Number(element.dataset.relativeFreshMinutes);
  const staleMinutes = Number(element.dataset.relativeStaleMinutes);
  const prefix = element.dataset.relativePrefix ?? "";
  const suffix = element.dataset.relativeSuffix ?? "";
  const staleSuffix = minutes >= staleMinutes ? element.dataset.relativeStaleSuffix ?? "" : "";
  element.textContent = `${prefix}${relativeTimeLabel(value)}${suffix}${staleSuffix}`;
  const tone = relativeTone(minutes, freshMinutes, staleMinutes);
  element.dataset.statusTone = tone;
  element.hidden = element.dataset.relativeHideWhenFresh === "true" && tone === "fresh";
  element.className = `${element.dataset.relativeBaseClass ?? ""} ${relativeToneClass(minutes, freshMinutes, staleMinutes)}`.trim();
}

export function refreshAllRelativeTimeStatuses(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-relative-time]")) {
    refreshRelativeTimeElement(element);
  }
}
