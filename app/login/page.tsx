import { redirect } from 'next/navigation';
import ActionLink from '@/components/ActionLink';
import AuthForm from '@/components/AuthForm';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseEnv } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { isConfigured } = getSupabaseEnv();

  if (isConfigured) {
    const supabase = await createClient();
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        redirect('/dashboard');
      }
    }
  }

  const params = await searchParams;
  const initialError =
    params.error === 'auth_callback_failed'
      ? 'No se pudo validar el enlace de acceso. Intenta iniciar sesión manualmente.'
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 transition-colors duration-300 ease-in-out dark:bg-black dark:text-zinc-100">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur-md transition-colors duration-300 ease-in-out dark:border-zinc-900 dark:bg-black/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <ActionLink
            href="/"
            showSpinner={false}
            loadingText="PulsoLocal"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 transition-colors duration-300 ease-in-out whitespace-nowrap shrink-0 dark:text-zinc-50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-extrabold text-slate-950 shadow-md shadow-amber-500/20">
              PL
            </span>
            <span>PulsoLocal</span>
          </ActionLink>
          <nav className="flex items-center gap-4 sm:gap-5 text-sm text-slate-600 dark:text-zinc-300">
            <ThemeToggle />
            <ActionLink
              href="/"
              loadingText="Cargando..."
              className="transition-colors duration-200 hover:text-slate-900 dark:hover:text-zinc-100 whitespace-nowrap shrink-0"
            >
              Inicio
            </ActionLink>
            <ActionLink
              href="/signup"
              loadingText="Cargando..."
              className="transition-colors duration-200 hover:text-slate-900 dark:hover:text-zinc-100 whitespace-nowrap shrink-0"
            >
              Crear cuenta
            </ActionLink>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthForm
          mode="login"
          isSupabaseConfigured={isConfigured}
          initialError={initialError}
        />
      </main>
    </div>
  );
}
