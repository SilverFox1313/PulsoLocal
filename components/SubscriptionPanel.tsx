'use client';

import { CheckCircle2, Clock, CreditCard, ShieldCheck } from 'lucide-react';
import {
  getRemainingTrialDays,
  TRIAL_DURATION_DAYS,
  TRIAL_MAX_REQUESTS,
} from '@/lib/subscription/trial';
import type { Business, SubscriptionStatus } from '@/types/database';

interface SubscriptionPanelProps {
  business: Business;
  userEmail: string;
  totalRequestsCount: number;
  onUpdated?: (updated: Business) => void;
}

function getStatusSummary(
  status: SubscriptionStatus,
  remainingDays: number,
  totalRequestsCount: number,
  trialRestrictedReason?: string | null
): { label: string; detail: string; isActive: boolean } {
  switch (status) {
    case 'active':
      return {
        label: 'Plan Pro Activo',
        detail:
          'Todas las funciones de envío automático por WhatsApp, hasta 300 envíos de reseña al mes y gestión de opiniones están habilitadas.',
        isActive: true,
      };
    case 'trialing': {
      const limitReached = totalRequestsCount >= TRIAL_MAX_REQUESTS;
      return {
        label: `Plan Trial — ${remainingDays} ${
          remainingDays === 1 ? 'día restante' : 'días restantes'
        }`,
        detail:
          remainingDays <= 0
            ? `Tu periodo de prueba de ${TRIAL_DURATION_DAYS} días ha finalizado. Selecciona el Plan Básico o Plan Pro para continuar creando solicitudes y enviando por WhatsApp.`
            : limitReached
              ? `Alcanzaste el límite de ${TRIAL_MAX_REQUESTS} solicitudes del Plan Trial. Selecciona el Plan Básico o Plan Pro para continuar enviando solicitudes.`
              : `Estás utilizando el periodo de prueba gratuito de ${TRIAL_DURATION_DAYS} días (hasta ${TRIAL_MAX_REQUESTS} solicitudes incluidas). Elige el Plan Básico o Plan Pro en cualquier momento para mantener el servicio sin interrupciones.`,
        isActive: false,
      };
    }
    case 'past_due':
      return {
        label: 'Pago pendiente',
        detail:
          'Detectamos un inconveniente con tu último cobro. Actualiza tu método de pago para reactivar tu plan.',
        isActive: false,
      };
    case 'canceled':
    case 'inactive':
    default:
      return {
        label: trialRestrictedReason ? 'Trial no disponible' : 'Plan Inactivo',
        detail:
          trialRestrictedReason ||
          'Tu suscripción no se encuentra activa en este momento. Selecciona un plan para reanudar los envíos automáticos.',
        isActive: false,
      };
  }
}

export default function SubscriptionPanel({
  business,
  userEmail,
  totalRequestsCount,
}: SubscriptionPanelProps) {
  const remainingDays = getRemainingTrialDays(business.created_at);
  const summary = getStatusSummary(
    business.subscription_status,
    remainingDays,
    totalRequestsCount,
    business.trial_restricted_reason
  );

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
        <div className="flex flex-col gap-6 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between dark:border-white/[0.04]">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-300">
              Estado actual de tu suscripción
            </p>
            <h2 className="mt-1.5 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl tabular-nums dark:text-zinc-50">
              {summary.isActive ? (
                <CheckCircle2
                  className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : (
                <Clock
                  className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              )}
              <span>{summary.label}</span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              {summary.detail}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">Negocio</p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">
              {business.business_name}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Solicitudes registradas
            </p>
            <p className="mt-1 text-sm font-medium tabular-nums text-slate-900 dark:text-zinc-100">
              {business.subscription_status === 'active'
                ? `${totalRequestsCount} / 300 este mes`
                : business.subscription_status === 'trialing'
                  ? `${totalRequestsCount} / ${TRIAL_MAX_REQUESTS} incluidas en Trial`
                  : business.trial_restricted_reason
                    ? `${totalRequestsCount} (sin Trial disponible)`
                    : `${totalRequestsCount} (sin plan activo)`}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Titular de facturación
            </p>
            <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-zinc-100">
              {userEmail}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
          <div>
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/[0.04]">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-50">
                  Plan Básico
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-300">
                  Para negocios locales que inician
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                $10{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-zinc-300">
                  USD / mes
                </span>
              </p>
            </div>

            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Envíos por mes
                </dt>
                <dd className="text-xs text-slate-800 dark:text-zinc-200">
                  Hasta 30 envíos / mes
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Envíos por WhatsApp
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Enlace a Google Maps
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Opiniones privadas (1–3 estrellas)
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-600 dark:text-zinc-300">Soporte</dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Estándar
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-8 space-y-3">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-orange-500 bg-transparent px-5 text-sm font-semibold opacity-50 cursor-not-allowed pointer-events-none transition-all"
            >
              <CreditCard
                className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400"
                aria-hidden="true"
              />
              <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                Suscribirse a Plan Básico
              </span>
            </button>

            <p className="text-center text-xs text-slate-500 dark:text-zinc-400">
              Pagos en línea disponibles próximamente.
            </p>
          </div>
        </div>

        <div className="flex h-full flex-col justify-between rounded-xl border border-amber-500/40 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-amber-500/40 dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
          <div>
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/[0.04]">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-50">
                  Plan Pro
                </h3>
                <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  Todo lo del Plan Básico para negocios en crecimiento
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-zinc-50">
                $29{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-zinc-300">
                  USD / mes
                </span>
              </p>
            </div>

            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Envíos por mes
                </dt>
                <dd className="text-xs text-slate-800 dark:text-zinc-200">
                  Hasta 300 envíos / mes
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Envíos automáticos por WhatsApp
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Enlace a Google Maps
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Opiniones privadas (1–3 estrellas)
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Plantilla oficial de WhatsApp
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-white/[0.04]">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Búsqueda y filtros en historial
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Soporte prioritario
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Respuesta &lt; 24 h
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-8 space-y-3">
            {business.subscription_status === 'active' ? (
              <div className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Plan Pro activo</span>
              </div>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-orange-500 bg-transparent px-5 text-sm font-semibold opacity-50 cursor-not-allowed pointer-events-none transition-all"
              >
                <CreditCard
                  className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400"
                  aria-hidden="true"
                />
                <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                  Suscribirse a Plan Pro
                </span>
              </button>
            )}

            <p className="text-center text-xs text-slate-500 dark:text-zinc-400">
              Pagos en línea disponibles próximamente.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
