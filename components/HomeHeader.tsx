'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import ActionLink from '@/components/ActionLink';
import ThemeToggle from '@/components/ThemeToggle';

interface HomeHeaderProps {
  isAuthenticated: boolean;
}

export default function HomeHeader({ isAuthenticated }: HomeHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-md transition-colors duration-300 ease-in-out dark:border-zinc-800 dark:bg-black/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-white"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-extrabold text-white shadow-md shadow-amber-500/20">
            PL
          </span>
          <span>PulsoLocal</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-3 sm:flex shrink-0">
          <ThemeToggle />

          {!isAuthenticated && (
            <ActionLink
              href="/login"
              loadingText="Iniciando..."
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-100 dark:shadow-none dark:backdrop-blur-sm dark:hover:border-zinc-500 dark:hover:bg-zinc-700 whitespace-nowrap shrink-0"
            >
              Iniciar sesión
            </ActionLink>
          )}

          <ActionLink
            href={isAuthenticated ? '/dashboard' : '/signup'}
            loadingText="Cargando..."
            className="inline-flex h-9 items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:from-amber-400 hover:to-orange-500 whitespace-nowrap shrink-0"
          >
            {isAuthenticated ? 'Ir al panel' : 'Crear cuenta'}
          </ActionLink>
        </div>

        {/* Mobile Nav Toggle */}
        <div className="flex items-center gap-2.5 sm:hidden shrink-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="absolute inset-x-0 top-full border-b border-slate-200 bg-white/95 px-6 py-6 shadow-xl backdrop-blur-xl sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
        >
          <nav className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {!isAuthenticated && (
              <ActionLink
                href="/login"
                loadingText="Iniciando..."
                className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                Iniciar sesión
              </ActionLink>
            )}

            <ActionLink
              href={isAuthenticated ? '/dashboard' : '/signup'}
              loadingText="Cargando..."
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-white shadow-md transition-all hover:from-amber-400 hover:to-orange-500"
            >
              {isAuthenticated ? 'Ir al panel' : 'Crear cuenta'}
            </ActionLink>
          </nav>
        </div>
      )}
    </header>
  );
}
