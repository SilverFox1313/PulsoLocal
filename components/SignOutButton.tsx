'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { signOutAction } from '@/app/dashboard/actions';
import { emitNavDone, emitNavStart } from '@/components/NavigationProgress';

interface SignOutButtonProps {
  fullWidth?: boolean;
}

let signOutInFlight = false;

export default function SignOutButton({ fullWidth = false }: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        signOutInFlight = false;
        isSubmittingRef.current = false;
        setIsSigningOut(false);
        emitNavDone();
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      isSubmittingRef.current = false;
      signOutInFlight = false;
    };
  }, []);

  async function handleSignOut() {
    if (isSubmittingRef.current || isSigningOut || signOutInFlight) {
      return;
    }

    isSubmittingRef.current = true;
    signOutInFlight = true;
    setIsSigningOut(true);
    emitNavStart();

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (response.ok) {
        window.location.assign('/login');
        return;
      }

      await signOutAction().catch(() => undefined);
      window.location.assign('/login');
    } catch {
      try {
        await signOutAction();
      } catch {
        // Ignora errores de transición de Server Action y redirige de forma segura
      }
      window.location.assign('/login');
    }
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
        disabled={isSigningOut}
        aria-busy={isSigningOut}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/50 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0 ${
          fullWidth ? 'h-11 w-full' : 'h-9'
        } ${isSigningOut ? 'pointer-events-none opacity-60' : ''}`}
      >
        {isSigningOut ? (
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
    </div>
  );
}
