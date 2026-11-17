import { ArrowRight, Star, ShieldCheck, MessageSquareText } from 'lucide-react';
import ActionLink from '@/components/ActionLink';
import HomeHeader from '@/components/HomeHeader';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let isAuthenticated = false;

  const supabase = await createClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = Boolean(user);
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 transition-colors duration-300 ease-in-out dark:bg-black dark:text-zinc-100">
      <HomeHeader isAuthenticated={isAuthenticated} variant="home" />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-semibold tracking-wide text-amber-600 dark:text-amber-400">
              Automatización y Reputación Local
            </p>

            <h1 className="text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl lg:leading-[1.1] dark:text-white">
              Convierte cada cliente en una reseña verificada en Google
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-zinc-300">
              Captura feedback privado a tiempo para atender a tus clientes al
              instante y potencia tus reseñas positivas en Google de forma
              transparente.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <ActionLink
                href={isAuthenticated ? '/dashboard' : '/signup'}
                loadingText="Preparando..."
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-7 text-sm font-semibold text-zinc-900 shadow-lg shadow-amber-500/25 transition-all hover:from-amber-400 hover:to-orange-500 dark:text-white whitespace-nowrap shrink-0"
              >
                <span>
                  {isAuthenticated ? 'Abrir mi panel' : 'Comenzar ahora'}
                </span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ActionLink>

              {!isAuthenticated && (
                <ActionLink
                  href="/login"
                  loadingText="Abriendo..."
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-7 text-sm font-medium text-slate-800 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-100 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-100 dark:shadow-none dark:hover:border-zinc-500 dark:hover:bg-zinc-700 whitespace-nowrap shrink-0"
                >
                  Ya tengo cuenta
                </ActionLink>
              )}
            </div>
          </div>
        </section>

        <section
          id="como-funciona"
          className="border-t border-slate-200/80 bg-white/60 py-20 transition-colors duration-300 ease-in-out dark:border-zinc-700/80 dark:bg-zinc-950/80"
        >
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                Cómo funciona tu flujo de satisfacción
              </h2>
              <p className="mt-3 text-base leading-relaxed text-slate-600 dark:text-zinc-300">
                Gestiona la satisfacción de tus clientes en un solo lugar y haz
                crecer tu reputación local de forma transparente, con datos
                aislados mediante seguridad a nivel de fila (RLS).
              </p>
            </div>

            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition-colors duration-300 ease-in-out hover:border-amber-500/40 dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:shadow-xl dark:backdrop-blur-md dark:hover:border-amber-500/50">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-orange-500/10 text-amber-600 shadow-xs dark:text-amber-400">
                  <MessageSquareText className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  01. Solicitud programada
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
                  Registra el nombre y teléfono del cliente y programa el envío
                  automático según el retraso configurado por tu negocio.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition-colors duration-300 ease-in-out hover:border-amber-500/40 dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:shadow-xl dark:backdrop-blur-md dark:hover:border-amber-500/50">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-orange-500/10 text-amber-600 shadow-xs dark:text-amber-400">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  02. Atención proactiva
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
                  Escucha primero a tus clientes insatisfechos para resolver su
                  problema al instante de manera interna, manteniéndoles siempre
                  visible el acceso a Google.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition-colors duration-300 ease-in-out hover:border-amber-500/40 dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:shadow-xl dark:backdrop-blur-md dark:hover:border-amber-500/50">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-orange-500/10 text-amber-600 shadow-xs dark:text-amber-400">
                  <Star className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  03. Impulso en Google
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
                  Facilita que tus clientes felices te recomienden con un clic y
                  permite que todo cliente acceda libremente a publicar su
                  reseña en tu perfil oficial de Google.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/80 bg-white/70 transition-colors duration-300 ease-in-out dark:border-zinc-700/80 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-xs text-slate-500 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <span>PulsoLocal · Automatizador de Reseñas y Reputación Local</span>
          <div className="flex items-center gap-6">
            <ActionLink
              href="/login"
              loadingText="Abriendo..."
              className="transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Iniciar sesión
            </ActionLink>
            <ActionLink
              href="/signup"
              loadingText="Cargando..."
              className="transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Crear cuenta
            </ActionLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
