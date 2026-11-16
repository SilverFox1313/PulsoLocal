'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pulsolocal-theme';
const THEME_EVENT = 'pulsolocal:theme-change';

function getSnapshot(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      const next: Theme = event.newValue === 'light' ? 'light' : 'dark';
      applyThemeToDom(next);
      callback();
    }
  };

  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener('storage', handleStorage);
  };
}

function applyThemeToDom(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === 'dark';

  function handleToggle() {
    const next: Theme = isDark ? 'light' : 'dark';
    applyThemeToDom(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignorar si localStorage no está disponible
    }
    window.dispatchEvent(new CustomEvent(THEME_EVENT));
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xs transition-colors duration-300 ease-in-out hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300 dark:shadow-none dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white shrink-0"
    >
      <Sun
        className="h-4 w-4 text-amber-400 transition-[transform,opacity] duration-300 ease-in-out -rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100"
        aria-hidden="true"
      />
      <Moon
        className="absolute h-4 w-4 text-slate-700 transition-[transform,opacity] duration-300 ease-in-out rotate-0 scale-100 opacity-100 dark:rotate-90 dark:scale-0 dark:opacity-0"
        aria-hidden="true"
      />
    </button>
  );
}
