import Link from 'next/link';
import { redirect } from 'next/navigation';
import SignOutButton from '@/components/SignOutButton';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();

  if (!supabase) {
    redirect('/login');
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('id, business_name, subscription_status, created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-8 px-6 py-4">
          <Link
            href="/dashboard"
            className="text-lg font-bold tracking-tight text-zinc-50 whitespace-nowrap shrink-0"
          >
            PulsoLocal
          </Link>

          <div className="flex items-center gap-4 shrink-0">
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="rounded-xl border border-zinc-800 bg-[#111114] p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-zinc-400">Panel de control</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                Bienvenido, {user.email}
              </h1>
              {business && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span>Negocio: {business.business_name}</span>
                  <span aria-hidden="true">·</span>
                  <span>Estado: {business.subscription_status}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 sm:hidden">
              <SignOutButton />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
