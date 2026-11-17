import { redirect } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import HomeHeader from '@/components/HomeHeader';
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
      <HomeHeader variant="login" />

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
