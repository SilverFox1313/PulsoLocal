import Link from 'next/link';
import { ArrowRight, Star, ShieldCheck, MessageSquareText } from 'lucide-react';
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
    <div className="flex min-h-screen flex-col bg-[#09090B] text-zinc-100">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-zinc-50 whitespace-nowrap shrink-0"
          >
            PulsoLocal
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
            <a
              href="#como-funciona"
              className="transition-colors hover:text-zinc-100 whitespace-nowrap shrink-0"
            >
              Cómo funciona
            </a>
            <Link
              href="/login"
              className="transition-colors hover:text-zinc-100 whitespace-nowrap shrink-0"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/signup"
              className="transition-colors hover:text-zinc-100 whitespace-nowrap shrink-0"
            >
              Registro
            </Link>
          </nav>

          <div className="flex items-center shrink-0">
            <Link
              href={isAuthenticated ? '/dashboard' : '/signup'}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 whitespace-nowrap shrink-0"
            >
              {isAuthenticated ? 'Ir al panel' : 'Crear cuenta'}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-amber-400">
              Automatizador de Reseñas y Reputación Local
            </p>
            <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl lg:text-6xl lg:leading-[1.08]">
              Convierte cada visita en una reseña verificada en Google
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
              Programa solicitudes automáticas tras cada atención, filtra
              experiencias negativas hacia un canal privado de mejora y dirige a
              tus clientes satisfechos directo a tu perfil de Google.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href={isAuthenticated ? '/dashboard' : '/signup'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 whitespace-nowrap shrink-0"
              >
                <span>
                  {isAuthenticated ? 'Abrir mi panel' : 'Comenzar ahora'}
                </span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              {!isAuthenticated && (
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-zinc-800 bg-[#111114] px-6 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 whitespace-nowrap shrink-0"
                >
                  Ya tengo cuenta
                </Link>
              )}
            </div>
          </div>
        </section>

        <section
          id="como-funciona"
          className="border-t border-zinc-800/80 bg-[#0C0C0F]"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Arquitectura del flujo de reputación
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Cada registro queda protegido por políticas de seguridad a nivel de
              fila (RLS) en PostgreSQL para aislar los datos de cada negocio.
            </p>

            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="rounded-xl border border-zinc-800/90 bg-[#111114] p-7">
                <MessageSquareText
                  className="h-5 w-5 text-amber-400"
                  aria-hidden="true"
                />
                <h3 className="mt-5 text-base font-semibold text-zinc-100">
                  01. Solicitud programada
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Registra el nombre y teléfono del cliente y programa el envío
                  automático según el retraso configurado por tu negocio.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800/90 bg-[#111114] p-7">
                <ShieldCheck
                  className="h-5 w-5 text-amber-400"
                  aria-hidden="true"
                />
                <h3 className="mt-5 text-base font-semibold text-zinc-100">
                  02. Filtro de experiencia
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Si la calificación es menor a 4 estrellas, capturamos el
                  comentario de forma privada para que tu equipo lo resuelva.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800/90 bg-[#111114] p-7">
                <Star className="h-5 w-5 text-amber-400" aria-hidden="true" />
                <h3 className="mt-5 text-base font-semibold text-zinc-100">
                  03. Impulso en Google
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Los clientes con calificación de 4 o 5 estrellas pasan con un
                  clic a publicar su reseña en tu enlace oficial de Google.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>PulsoLocal · Automatizador de Reseñas y Reputación Local</span>
          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-zinc-300">
              Acceso
            </Link>
            <Link href="/signup" className="hover:text-zinc-300">
              Registro
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
