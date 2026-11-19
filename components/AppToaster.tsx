'use client';

import { useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react';

type Theme = 'light' | 'dark';

const THEME_EVENT = 'pulsolocal:theme-change';

function getThemeSnapshot(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerThemeSnapshot(): Theme {
  return 'dark';
}

function subscribeTheme(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener('storage', callback);

  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export default function AppToaster() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  return (
    <Toaster
      position="bottom-right"
      theme={theme}
      richColors
      closeButton
      duration={4000}
      style={{ zIndex: 9999 }}
      icons={{
        success: (
          <CheckCircle2
            className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        ),
        error: (
          <AlertCircle
            className="h-4 w-4 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
        ),
        info: (
          <Info
            className="h-4 w-4 text-sky-600 dark:text-sky-400"
            aria-hidden="true"
          />
        ),
        loading: (
          <Loader2
            className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            'rounded-xl border border-slate-200/80 shadow-lg font-sans dark:border-white/[0.08] dark:shadow-2xl dark:shadow-black/60',
          title: 'text-sm font-medium',
          description: 'text-xs opacity-90',
          closeButton:
            'border-slate-200 bg-white text-slate-500 hover:text-slate-900 dark:border-white/10 dark:bg-[#27272E] dark:text-zinc-300 dark:hover:text-white',
        },
      }}
    />
  );
}
