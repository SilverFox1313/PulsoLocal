import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import { getSupabaseEnv } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
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

  return (
    <div className="flex min-h-screen flex-col bg-[#09090B]">
      <header className="flex items-center justify-between gap-8 border-b border-zinc-800/80 px-6 py-4 lg:px-10">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-zinc-50 whitespace-nowrap shrink-0"
        >
          PulsoLocal
        </Link>
        <nav className="flex items-center gap-6 text-sm text-zinc-400">
          <Link
            href="/"
            className="transition-colors hover:text-zinc-100 whitespace-nowrap shrink-0"
          >
            Inicio
          </Link>
          <Link
            href="/login"
            className="transition-colors hover:text-zinc-100 whitespace-nowrap shrink-0"
          >
            Iniciar sesión
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthForm mode="signup" isSupabaseConfigured={isConfigured} />
      </main>
    </div>
  );
}
