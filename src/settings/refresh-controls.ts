import {
  isValidRefreshIntervalMinutes,
  MAX_REFRESH_INTERVAL_MINUTES,
  MIN_REFRESH_INTERVAL_MINUTES,
  PRESET_REFRESH_INTERVALS,
  refreshUnitMultiplier,
  type RefreshUnit,
} from "../shared/refresh-interval.ts";

export function setCustomIntervalInputLimit(input: HTMLInputElement, unit: RefreshUnit): void {
  input.max = String(Math.floor(MAX_REFRESH_INTERVAL_MINUTES / refreshUnitMultiplier(unit)));
}

export function renderRefreshInterval(
  select: HTMLSelectElement,
  customGroup: HTMLElement,
  customInput: HTMLInputElement,
  customUnit: HTMLSelectElement,
  valueMinutes: number,
): void {
  const normalized = isValidRefreshIntervalMinutes(valueMinutes) ? valueMinutes : 1_440;
  const preset = PRESET_REFRESH_INTERVALS.includes(normalized as typeof PRESET_REFRESH_INTERVALS[number]);
  select.value = preset ? String(normalized) : "custom";
  const unit: RefreshUnit = normalized % 1_440 === 0 ? "day" : normalized % 60 === 0 ? "hour" : "minute";
  customUnit.value = unit;
  customInput.value = String(normalized / refreshUnitMultiplier(unit));
  setCustomIntervalInputLimit(customInput, unit);
  customGroup.hidden = preset;
}

export function selectedRefreshInterval(
  select: HTMLSelectElement,
  customInput: HTMLInputElement,
  customUnit: HTMLSelectElement,
): number {
  const unit = customUnit.value as RefreshUnit;
  const valueMinutes = select.value === "custom"
    ? Number(customInput.value) * refreshUnitMultiplier(unit)
    : Number(select.value);
  if (!isValidRefreshIntervalMinutes(valueMinutes)) {
    throw new Error(`更新间隔需为 ${MIN_REFRESH_INTERVAL_MINUTES} 到 ${MAX_REFRESH_INTERVAL_MINUTES} 分钟`);
  }
  return valueMinutes;
}

export function storedRefreshIntervalMinutes(
  stored: Record<string, unknown>,
  key: string,
  legacyHoursKey: string,
  fallbackMinutes: number,
): number {
  const intervalMinutes = Number(stored[key]);
  if (isValidRefreshIntervalMinutes(intervalMinutes)) return intervalMinutes;
  const legacyMinutes = Number(stored[legacyHoursKey]) * 60;
  return isValidRefreshIntervalMinutes(legacyMinutes) ? legacyMinutes : fallbackMinutes;
}

export function setRefreshControlsDisabled(
  disabled: boolean,
  select: HTMLSelectElement,
  customInput: HTMLInputElement,
  customUnit: HTMLSelectElement,
): void {
  select.disabled = disabled;
  customInput.disabled = disabled;
  customUnit.disabled = disabled;
}
