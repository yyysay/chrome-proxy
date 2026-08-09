export type StatusBadgeTone = "idle" | "fresh" | "stale" | "error";

export function setStatusBadge(
  element: HTMLElement,
  text: string,
  tone: StatusBadgeTone,
  title?: string,
  hideWhenFresh = false,
): void {
  element.className = "status-badge";
  element.dataset.statusTone = tone;
  element.textContent = text;
  if (title) element.title = title;
  else element.removeAttribute("title");
  element.hidden = hideWhenFresh && tone === "fresh";
}
