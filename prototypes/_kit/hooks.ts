import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

const onHash = (fn: () => void) => {
  addEventListener('hashchange', fn);
  return () => removeEventListener('hashchange', fn);
};

// Hash routes keep a prototype's own pages out of the shell's path:
// /sample-list/#/items/42?tab=overview
export function useHashRoute(fallback = '#/') {
  const hash = useSyncExternalStore(onHash, () => location.hash || fallback);
  const [path, search = ''] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(search));
  const go = useCallback((to: string) => {
    location.hash = to;
  }, []);
  return { hash, path, query, go };
}
