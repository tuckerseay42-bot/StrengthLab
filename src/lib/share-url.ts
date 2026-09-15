// Returns a public origin safe to share externally.
// Preview hosts (id-preview--*.lovable.app) sit behind Lovable's auth gate,
// which makes recipients hit a Lovable login screen instead of the app.
// When the current origin is a preview host, fall back to the published
// domain so invite/QR links land on the real app.
const PUBLISHED_ORIGIN = "https://www.strengthlabhub.com";

export function publicOrigin(): string {
  if (typeof window === "undefined") return PUBLISHED_ORIGIN;
  const host = window.location.hostname;
  const isPreview =
    host.includes("id-preview--") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith(".lovable.app"); // prefer the custom domain over lovable subdomains
  return isPreview ? PUBLISHED_ORIGIN : window.location.origin;
}

