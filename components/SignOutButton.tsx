'use client';

import { useState, useTransition } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { signOutAction } from '@/app/dashboard/actions';
import { emitNavDone, emitNavStart } from '@/components/NavigationProgress';

interface SignOutButtonProps {
  fullWidth?: boolean;
}

export default function SignOutButton({ fullWidth = false }: SignOutButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSignOut() {
    if (isPending) return;
    setError(null);
    emitNavStart();
    startTransition(async () => {
      const result = await signOutAction();
      if (result?.error) {
        emitNavDone();
        setError(result.error);
      }
    });
  }

  return (
    <div
      className={`flex flex-col gap-1.5 ${
        fullWidth ? 'w-full items-stretch' : 'items-end'
      }`}
    >
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isPending}
        aria-busy={isPending}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/50 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0 ${
          fullWidth ? 'h-11 w-full' : 'h-9'
        } ${isPending ? 'pointer-events-none opacity-60' : ''}`}
      >
        {isPending ? (
          <>
            <Loader2
              className="h-4 w-4 animate-spin text-slate-400 dark:text-zinc-300"
              aria-hidden="true"
            />
            <span>Cerrando sesión...</span>
          </>
        ) : (
          <>
            <LogOut
              className="h-4 w-4 text-slate-500 dark:text-zinc-300"
              aria-hidden="true"
            />
            <span>Cerrar sesión</span>
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
