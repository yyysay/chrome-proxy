import { requiredElement } from "./dom.ts";

type ToastTone = "success" | "error" | "warning" | "info";

const toastHost = requiredElement<HTMLElement>("#toast-host");

function inferToastTone(message: string): ToastTone {
  if (/失败|异常|错误|无法|无效|超时/.test(message)) return "error";
  if (/回退|缓存|未配置|相同|请先/.test(message)) return "warning";
  if (/正在|读取|检测|下载/.test(message)) return "info";
  return "success";
}

export function showToast(message: string, tone: ToastTone = inferToastTone(message)): void {
  const text = message.trim();
  if (!text) return;
  const toast = document.createElement("div");
  const toneClasses: Record<ToastTone, string> = {
    success: "border-emerald-200 bg-emerald-50/95 text-emerald-800 dark:border-[#30d158]/35 dark:bg-[#203329]/95 dark:text-[#30d158]",
    error: "border-red-200 bg-red-50/95 text-red-800 dark:border-[#ff453a]/40 dark:bg-[#3a2424]/95 dark:text-[#ff6961]",
    warning: "border-amber-200 bg-amber-50/95 text-amber-800 dark:border-[#ff9f0a]/40 dark:bg-[#392e1f]/95 dark:text-[#ff9f0a]",
    info: "border-stone-200 bg-white/95 text-stone-700 dark:border-white/15 dark:bg-[#2c2c2e]/95 dark:text-white/80",
  };
  toast.className = `flex -translate-y-2 items-start gap-2.5 rounded-xl border px-4 py-3 opacity-0 shadow-[0_14px_40px_rgba(28,25,23,.12)] backdrop-blur transition duration-200 ${toneClasses[tone]}`;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  const dot = document.createElement("span");
  dot.className = `mt-1.5 size-2 shrink-0 rounded-full ${
    tone === "success" ? "bg-emerald-500 dark:bg-[#30d158]" : tone === "error" ? "bg-red-500 dark:bg-[#ff453a]" : tone === "warning" ? "bg-amber-500 dark:bg-[#ff9f0a]" : "bg-stone-400 dark:bg-white/45"
  }`;
  dot.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "text-sm font-semibold leading-5";
  copy.textContent = text;
  toast.append(dot, copy);
  toastHost.append(toast);
  try {
    if (toastHost.matches(":popover-open")) toastHost.hidePopover();
    toastHost.showPopover();
  } catch {
    // 不支持 Popover API 时仍使用 fixed + z-index 展示。
  }
  requestAnimationFrame(() => {
    toast.classList.remove("-translate-y-2", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  });
  window.setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("-translate-y-1", "opacity-0");
  }, 2600);
  window.setTimeout(() => {
    toast.remove();
    if (toastHost.childElementCount === 0) {
      try { toastHost.hidePopover(); } catch { /* 已关闭或不支持 Popover API。 */ }
    }
  }, 3200);
}
