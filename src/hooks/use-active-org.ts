import { useSyncExternalStore } from "react";

const KEY = "sl.activeOrgId";
const listeners = new Set<() => void>();

function get(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}
function set(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(KEY, id);
  else window.localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useActiveOrgId(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, get, () => null);
  return [id, set];
}

export function getActiveOrgId(): string | null {
  return get();
}
