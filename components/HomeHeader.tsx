'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import ActionLink from '@/components/ActionLink';
import ThemeToggle from '@/components/ThemeToggle';

interface HomeHeaderProps {
  isAuthenticated?: boolean;
  variant?: 'home' | 'login' | 'signup';
}

export default function HomeHeader({
  isAuthenticated = false,
  variant = 'home',
}: HomeHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAuthPage = variant === 'login' || variant === 'signup';

  return (
    <header className="sticky top-0 z-50 bg-transparent backdrop-blur-md shadow-sm transition-colors duration-300 ease-in-out dark:bg-transparent dark:shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-white"
        >
          <span className="relative inline-flex items-center justify-center text-xl">
            <span className="absolute top-0.5 right-[7px] h-3 w-3 rounded-full bg-red-500 opacity-90 animate-ping pointer-events-none" />
            📍
          </span>
          <span>PulsoLocal</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-3 sm:flex shrink-0">
          <ThemeToggle />

          {isAuthPage ? (
            <>
              <ActionLink
                href="/"
                loadingText="Cargando..."
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/50 hover:dark:bg-[#32323A] dark:hover:text-white whitespace-nowrap shrink-0"
              >
                Inicio
              </ActionLink>
              <ActionLink
                href={variant === 'login' ? '/signup' : '/login'}
                loadingText="Cargando..."
                className="inline-flex h-9 items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-zinc-900 shadow-lg shadow-amber-500/25 transition-all hover:from-amber-400 hover:to-orange-500 dark:text-white whitespace-nowrap shrink-0"
              >
                {variant === 'login' ? 'Crear cuenta' : 'Iniciar sesión'}
              </ActionLink>
            </>
          ) : (
            <>
              {!isAuthenticated && (
                <ActionLink
                  href="/login"
                  loadingText="Iniciando..."
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/50 hover:dark:bg-[#32323A] dark:hover:text-white whitespace-nowrap shrink-0"
                >
                  Iniciar sesión
                </ActionLink>
              )}

              <ActionLink
                href={isAuthenticated ? '/dashboard' : '/signup'}
                loadingText="Cargando..."
                className="inline-flex h-9 items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-zinc-900 shadow-lg shadow-amber-500/25 transition-all hover:from-amber-400 hover:to-orange-500 dark:text-white whitespace-nowrap shrink-0"
              >
                {isAuthenticated ? 'Ir al panel' : 'Registrarse'}
              </ActionLink>
            </>
          )}
        </div>

        {/* Mobile Nav Toggle */}
        <div className="flex items-center gap-2.5 sm:hidden shrink-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileMenuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/50 hover:dark:bg-[#32323A]"
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
          className="absolute inset-x-0 top-full border-b border-slate-200 bg-white/95 px-6 py-6 shadow-xl backdrop-blur-xl sm:hidden dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
        >
          <nav
            className="flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {isAuthPage ? (
              <>
                <ActionLink
                  href="/"
                  loadingText="Cargando..."
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:bg-slate-100 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 hover:dark:bg-[#32323A] dark:shadow-md dark:shadow-black/50"
                >
                  Inicio
                </ActionLink>
                <ActionLink
                  href={variant === 'login' ? '/signup' : '/login'}
                  loadingText="Cargando..."
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-zinc-900 shadow-md transition-all hover:from-amber-400 hover:to-orange-500 dark:text-white"
                >
                  {variant === 'login' ? 'Registrarse' : 'Iniciar sesión'}
                </ActionLink>
              </>
            ) : (
              <>
                {!isAuthenticated && (
                  <ActionLink
                    href="/login"
                    loadingText="Iniciando..."
                    className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:bg-slate-100 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 hover:dark:bg-[#32323A] dark:shadow-md dark:shadow-black/50"
                  >
                    Iniciar sesión
                  </ActionLink>
                )}

                <ActionLink
                  href={isAuthenticated ? '/dashboard' : '/signup'}
                  loadingText="Cargando..."
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-zinc-900 shadow-md transition-all hover:from-amber-400 hover:to-orange-500 dark:text-white"
                >
                  {isAuthenticated ? 'Ir al panel' : 'Crear cuenta'}
                </ActionLink>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
