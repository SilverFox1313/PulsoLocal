'use client';

import { useEffect, useState } from 'react';
import { FileText, ShieldCheck, X } from 'lucide-react';

type LegalModalType = 'privacy' | 'legal' | null;

export default function LandingFooter() {
  const [activeModal, setActiveModal] = useState<LegalModalType>(null);

  useEffect(() => {
    if (!activeModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveModal(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal]);

  return (
    <>
      <footer className="border-t border-slate-200/80 bg-white/70 transition-colors duration-300 ease-in-out dark:border-transparent dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-xs text-slate-500 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <span>PulsoLocal · Automatizador de Reseñas y Reputación Local</span>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveModal('privacy')}
              className="cursor-pointer transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Políticas de Privacidad
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('legal')}
              className="cursor-pointer transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Aviso Legal
            </button>
          </div>
        </div>
      </footer>

      {activeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-modal-title"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-colors duration-300 ease-in-out dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-white/[0.04]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                  {activeModal === 'privacy' ? (
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <FileText className="h-4 w-4" aria-hidden="true" />
                  )}
                </div>
                <h2
                  id="legal-modal-title"
                  className="text-base font-semibold text-slate-900 dark:text-white"
                >
                  {activeModal === 'privacy'
                    ? 'Políticas de Privacidad'
                    : 'Aviso Legal'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="Cerrar modal"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-400 dark:hover:bg-[#27272E] dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              {activeModal === 'privacy' ? (
                <>
                  <p>
                    En <strong className="font-semibold text-slate-900 dark:text-white">PulsoLocal</strong>, la privacidad y seguridad de los datos de tu negocio y de tus clientes son prioritarias. Esta política describe cómo tratamos la información dentro de la plataforma.
                  </p>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      1. Datos recopilados y finalidad
                    </h3>
                    <p className="mt-1">
                      Tratamos únicamente los datos de cuenta del negocio (correo electrónico, nombre comercial y enlace de reseñas de Google) y los datos de contacto ingresados para cada solicitud (nombre y número de teléfono del cliente) con el único fin de programar y enviar invitaciones de opinión o reseña por WhatsApp.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      2. Aislamiento y seguridad
                    </h3>
                    <p className="mt-1">
                      Cada cuenta opera en un entorno protegido con aislamiento estricto de datos, garantizando que únicamente el titular autenticado pueda consultar, editar o eliminar sus solicitudes y comentarios internos.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      3. No comercialización y derechos
                    </h3>
                    <p className="mt-1">
                      PulsoLocal no vende, alquila ni comparte listas de clientes con terceros ajenos a la entrega técnica de mensajería. Puedes editar o eliminar tus solicitudes pendientes y gestionar tu información directamente desde tu panel en cualquier momento.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    El presente <strong className="font-semibold text-slate-900 dark:text-white">Aviso Legal</strong> regula el uso de la plataforma <strong className="font-semibold text-slate-900 dark:text-white">PulsoLocal</strong>, diseñada como herramienta de software para la gestión de satisfacción y reputación local de comercios y profesionales.
                  </p>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      1. Transparencia en reseñas
                    </h3>
                    <p className="mt-1">
                      PulsoLocal promueve buenas prácticas de reputación digital: los flujos de opinión permiten recopilar comentarios privados para mejorar la atención al cliente manteniendo siempre visible y accesible la opción directa para publicar reseñas libremente en Google Maps, sin bloqueos ni condicionamientos.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      2. Consentimiento y mensajería
                    </h3>
                    <p className="mt-1">
                      Cada negocio usuario es responsable de contar con el consentimiento previo de sus clientes antes de registrar sus números telefónicos y programar el envío de invitaciones a través de canales de mensajería como WhatsApp.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      3. Propiedad intelectual y uso del servicio
                    </h3>
                    <p className="mt-1">
                      La interfaz, código, marca y materiales de PulsoLocal están protegidos por la normativa aplicable de propiedad intelectual. El servicio se ofrece bajo los términos de disponibilidad vigentes para el plan contratado y no guarda afiliación directa con Google LLC ni Meta Platforms, Inc.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50/80 px-6 py-3.5 dark:border-white/[0.04] dark:bg-[#1E1E24]">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:bg-slate-100 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/40 hover:dark:bg-[#32323A]"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
