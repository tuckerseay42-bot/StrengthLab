// iOS Safari has no Fullscreen API for ordinary elements (only <video> gets a
// native fullscreen) — document.documentElement.requestFullscreen simply
// doesn't exist there, so a "Fullscreen" button wired only to that API is
// silently dead on an iPhone/iPad. Callers check this first and fall back to
// a CSS-only "cover the viewport" treatment when it's false.
export function fullscreenApiSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: unknown;
  };
  return (
    typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function"
  );
}
