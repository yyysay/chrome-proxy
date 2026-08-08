import { getProxyStatus } from "../proxy/proxy-manager.ts";

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const denominator = abx * abx + aby * aby;
  const t = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, (apx * abx + apy * aby) / denominator));
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

function createActionIconImageData(size: number, active: boolean): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const [red, green, blue] = active ? [22, 163, 74] : [87, 83, 78];
  const scale = size / 32;
  const strokeWidth = Math.max(1.35, 2.25 * scale);
  const feather = Math.max(0.45, 0.8 * scale);
  const segments: Array<[number, number, number, number]> = [
    [9 * scale, 25 * scale, 15.4 * scale, 6.5 * scale],
    [16.6 * scale, 6.5 * scale, 23 * scale, 25 * scale],
    [11.9 * scale, 18.5 * scale, 20.1 * scale, 18.5 * scale],
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let distance = Number.POSITIVE_INFINITY;

      for (const [ax, ay, bx, by] of segments) {
        distance = Math.min(distance, pointToSegmentDistance(px, py, ax, ay, bx, by));
      }

      const alpha = Math.max(
        0,
        Math.min(255, Math.round(((strokeWidth + feather - distance) / feather) * 255)),
      );
      if (alpha <= 0) continue;

      const offset = (y * size + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
    }
  }

  return new ImageData(data, size, size);
}

export async function syncActionState(): Promise<void> {
  const active = (await getProxyStatus()).applied;

  // 工具栏外观是尽力而为，不能阻塞保存订阅或启用代理等核心操作。
  const tasks: Promise<unknown>[] = [
    chrome.action.setBadgeText({ text: "" }),
    chrome.action.setTitle({
      title: active ? "规则分流已开启" : "规则分流已关闭",
    }),
  ];

  try {
    tasks.push(chrome.action.setIcon({
      imageData: {
        16: createActionIconImageData(16, active),
        32: createActionIconImageData(32, active),
      },
    }));
  } catch (error) {
    console.warn("Unable to prepare dynamic action icon", error);
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Unable to update action appearance", result.reason);
    }
  }
}
