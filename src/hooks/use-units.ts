import { useEffect, useState } from "react";
import { defaultPrefs, type UnitPrefs } from "@/lib/units";

const KEY = "sl.unit_prefs.v1";

function read(): UnitPrefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultPrefs;
    return { ...defaultPrefs, ...JSON.parse(raw) } as UnitPrefs;
  } catch {
    return defaultPrefs;
  }
}

const listeners = new Set<() => void>();

export function useUnitPrefs(): [UnitPrefs, (next: Partial<UnitPrefs>) => void] {
  const [prefs, setPrefs] = useState<UnitPrefs>(read);

  useEffect(() => {
    const cb = () => setPrefs(read());
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);

  const update = (next: Partial<UnitPrefs>) => {
    const merged = { ...read(), ...next };
    window.localStorage.setItem(KEY, JSON.stringify(merged));
    listeners.forEach((l) => l());
  };

  return [prefs, update];
}
