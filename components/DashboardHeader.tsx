'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import SignOutButton from '@/components/SignOutButton';
import ThemeToggle from '@/components/ThemeToggle';

export default function DashboardHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-md transition-colors duration-300 ease-in-out dark:border-zinc-700/80 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-zinc-50"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-extrabold text-white shadow-md shadow-amber-500/20">
            PL
          </span>
          <span>PulsoLocal</span>
        </Link>

        {/* Desktop actions */}
        <div className="hidden items-center gap-3 sm:flex shrink-0">
          <ThemeToggle />
          <SignOutButton />
        </div>

        {/* Mobile menu toggle */}
        <div className="flex items-center gap-2.5 sm:hidden shrink-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileMenuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="absolute inset-x-0 top-full border-b border-slate-200 bg-white/95 px-6 py-6 shadow-xl backdrop-blur-xl sm:hidden dark:border-zinc-700 dark:bg-zinc-900/95"
        >
          <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <SignOutButton fullWidth />
          </div>
        </div>
      )}
    </header>
  );
}
