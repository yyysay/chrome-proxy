import assert from "node:assert/strict";
import test from "node:test";

import {
  DISABLED_REFRESH_INTERVAL_MINUTES,
  formatRefreshInterval,
  isValidRefreshIntervalMinutes,
  legacyHoursToMinutes,
  normalizeRefreshIntervalMinutes,
  refreshStatusThresholds,
  refreshUnitMultiplier,
} from "../src/shared/refresh-interval.ts";
import { storedRefreshIntervalMinutes } from "../src/settings/refresh-controls.ts";

test("validates refresh intervals in minutes", () => {
  assert.equal(isValidRefreshIntervalMinutes(1), true);
  assert.equal(isValidRefreshIntervalMinutes(43_200), true);
  assert.equal(isValidRefreshIntervalMinutes(0), false);
  assert.equal(isValidRefreshIntervalMinutes(1.5), false);
  assert.equal(isValidRefreshIntervalMinutes(43_201), false);
});

test("migrates legacy hours and preserves a safe fallback", () => {
  assert.equal(legacyHoursToMinutes(24), 1_440);
  assert.equal(legacyHoursToMinutes("6"), 360);
  assert.equal(legacyHoursToMinutes("invalid"), undefined);
  assert.equal(normalizeRefreshIntervalMinutes(90), 90);
  assert.equal(normalizeRefreshIntervalMinutes("invalid", 360), 360);
});

test("formats update intervals using the largest exact unit", () => {
  assert.equal(formatRefreshInterval(30), "30 分钟");
  assert.equal(formatRefreshInterval(120), "2 小时");
  assert.equal(formatRefreshInterval(1_440), "1 天");
  assert.equal(formatRefreshInterval(2_880), "2 天");
  assert.equal(refreshUnitMultiplier("minute"), 1);
  assert.equal(refreshUnitMultiplier("hour"), 60);
  assert.equal(refreshUnitMultiplier("day"), 1_440);
});

test("preserves the disabled proxy refresh setting", () => {
  assert.equal(DISABLED_REFRESH_INTERVAL_MINUTES, 0);
  assert.equal(storedRefreshIntervalMinutes({ proxyRefresh: 0 }, "proxyRefresh", "legacy", 360), 0);
});

test("derives reminder thresholds from the automatic refresh interval", () => {
  assert.deepEqual(refreshStatusThresholds(true, 720, 360, 1_440), {
    freshMinutes: 900,
    staleMinutes: 1_440,
  });
  assert.deepEqual(refreshStatusThresholds(false, 0, 360, 1_440), {
    freshMinutes: 360,
    staleMinutes: 1_440,
  });
});
