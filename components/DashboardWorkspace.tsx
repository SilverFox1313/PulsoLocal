'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  MessageSquareWarning,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import BusinessSettingsForm from '@/components/BusinessSettingsForm';
import PrivateFeedbackList from '@/components/PrivateFeedbackList';
import ReviewRequestForm from '@/components/ReviewRequestForm';
import ReviewRequestsTable from '@/components/ReviewRequestsTable';
import SubscriptionPanel from '@/components/SubscriptionPanel';
import type {
  Business,
  PrivateFeedbackItem,
  ReviewRequest,
} from '@/types/database';

interface DashboardWorkspaceProps {
  userEmail: string;
  initialBusiness: Business | null;
  initialRequests: ReviewRequest[];
  initialFeedback: PrivateFeedbackItem[];
  loadError?: string | null;
}

interface ProcessedReminderItem {
  id: string;
  customerName: string;
  customerPhone: string;
  reviewLink: string;
  messagePreview: string;
  deliveryMode: 'twilio' | 'simulated';
}

interface DispatchSummary {
  mode: 'twilio' | 'simulated';
  processed: number;
  failed: number;
  pendingFutureCount: number;
  items: ProcessedReminderItem[];
}

type DashboardTab = 'requests' | 'feedback' | 'settings' | 'subscription';

function getHeaderPlanLabel(business: Business): string {
  if (business.subscription_status === 'active') {
    return 'Plan Pro Activo';
  }
  if (business.subscription_status === 'trialing') {
    const createdMs = new Date(business.created_at).getTime();
    const elapsedDays = Number.isNaN(createdMs)
      ? 0
      : Math.floor(Math.max(0, Date.now() - createdMs) / 86_400_000);
    const remaining = Math.max(0, 14 - elapsedDays);
    return `Plan Trial (${remaining} d restantes)`;
  }
  if (business.subscription_status === 'past_due') {
    return 'Pago pendiente';
  }
  return 'Plan inactivo';
}

export default function DashboardWorkspace({
  userEmail,
  initialBusiness,
  initialRequests,
  initialFeedback,
  loadError = null,
}: DashboardWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>('requests');
  const [business, setBusiness] = useState<Business | null>(initialBusiness);
  const [requests, setRequests] = useState<ReviewRequest[]>(initialRequests);

  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSummary, setDispatchSummary] =
    useState<DispatchSummary | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const negativeFeedbackCount = initialFeedback.filter(
    (item) => item.rating <= 3
  ).length;

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  function handleRequestCreated(newRequest: ReviewRequest) {
    setRequests((prev) => [newRequest, ...prev]);
    setDispatchSummary(null);
  }

  function handleBusinessUpdated(updated: Business) {
    setBusiness(updated);
  }

  async function handleCopyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      // Silencioso si el portapapeles no está disponible
    }
  }

  async function runSendReminders(includeFuture = false) {
    setDispatchError(null);
    setDispatching(true);

    try {
      const response = await fetch('/api/cron/send-reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeFuture }),
      });

      const payload = (await response.json().catch(() => ({}))) as
        | (DispatchSummary & { ok?: boolean; error?: string })
        | undefined;

      if (!response.ok || !payload?.ok) {
        setDispatchError(
          payload?.error ||
            'No se pudo ejecutar la verificación de envíos pendientes.'
        );
        setDispatching(false);
        return;
      }

      const sentIds = new Set(payload.items.map((item) => item.id));
      if (sentIds.size > 0) {
        setRequests((prev) =>
          prev.map((req) =>
            sentIds.has(req.id) ? { ...req, status: 'sent' } : req
          )
        );
      }

      setDispatchSummary({
        mode: payload.mode,
        processed: payload.processed,
        failed: payload.failed,
        pendingFutureCount: payload.pendingFutureCount,
        items: payload.items,
      });

      router.refresh();
    } catch {
      setDispatchError(
        'Error de conexión al ejecutar la verificación de envíos.'
      );
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-6 border-b border-zinc-800/80 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-zinc-400">Panel de control</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            Bienvenido, {userEmail}
          </h1>
          {business && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-medium text-zinc-200">
                {business.business_name}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Retraso: {business.delay_minutes} min
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {business.google_review_url
                  ? 'Enlace de Google configurado'
                  : 'Falta configurar enlace de Google'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums text-zinc-300">
                {getHeaderPlanLabel(business)}
              </span>
            </div>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Secciones del panel"
          className="inline-flex w-fit flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-[#111114] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'requests'}
            onClick={() => setActiveTab('requests')}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'requests'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span>Solicitudes</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'feedback'}
            onClick={() => setActiveTab('feedback')}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'feedback'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">
              Opiniones Privadas
              {negativeFeedbackCount > 0 ? ` (${negativeFeedbackCount})` : ''}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            <span>Configuración</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'subscription'}
            onClick={() => setActiveTab('subscription')}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'subscription'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            <span>Suscripción</span>
          </button>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
            aria-hidden="true"
          />
          <span>{loadError}</span>
        </div>
      )}

      {business && !business.google_review_url && activeTab === 'requests' && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-100">
            Aún no has agregado tu enlace directo de reseñas de Google Maps.
            Configúralo antes de enviar tus primeras invitaciones.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-500/40 bg-zinc-950/60 px-3.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-zinc-950 whitespace-nowrap shrink-0"
          >
            Configurar enlace
          </button>
        </div>
      )}

      {!business ? (
        <section className="rounded-xl border border-zinc-800 bg-[#111114] p-8 text-sm text-zinc-400">
          No se encontró el perfil del negocio en Supabase. Verifica que hayas
          ejecutado el script SQL de creación de tablas y políticas RLS en tu
          proyecto.
        </section>
      ) : activeTab === 'requests' ? (
        <div className="space-y-8">
          <ReviewRequestForm
            delayMinutes={business.delay_minutes}
            onCreated={handleRequestCreated}
          />

          <section className="rounded-xl border border-zinc-800 bg-[#111114] p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-zinc-50">
                  Automatización de envíos
                </h2>
                <p className="mt-1 text-sm text-zinc-400 tabular-nums">
                  {pendingCount === 0
                    ? 'No hay solicitudes en estado pendiente en este momento.'
                    : `${pendingCount} ${
                        pendingCount === 1
                          ? 'solicitud pendiente'
                          : 'solicitudes pendientes'
                      } esperando su hora programada.`}
                </p>
              </div>

              <button
                type="button"
                disabled={dispatching}
                onClick={() => runSendReminders(false)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {dispatching ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Verificando envíos...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>Verificar y Enviar Pendientes</span>
                  </>
                )}
              </button>
            </div>

            {dispatchError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                  aria-hidden="true"
                />
                <span>{dispatchError}</span>
              </div>
            )}

            {dispatchSummary && (
              <div className="mt-5 border-t border-zinc-800/80 pt-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-zinc-100 tabular-nums">
                        {dispatchSummary.processed}{' '}
                        {dispatchSummary.processed === 1
                          ? 'solicitud procesada'
                          : 'solicitudes procesadas'}{' '}
                        ·{' '}
                        <span className="text-zinc-400">
                          {dispatchSummary.mode === 'twilio'
                            ? 'Enviado por Twilio SMS'
                            : 'Modo simulado (sin Twilio)'}
                        </span>
                      </p>
                      {dispatchSummary.processed === 0 &&
                        dispatchSummary.pendingFutureCount > 0 && (
                          <p className="mt-1 text-xs text-zinc-400 tabular-nums">
                            Tienes {dispatchSummary.pendingFutureCount}{' '}
                            {dispatchSummary.pendingFutureCount === 1
                              ? 'solicitud cuya hora programada aún no se cumple'
                              : 'solicitudes cuya hora programada aún no se cumple'}
                            .
                          </p>
                        )}
                    </div>
                  </div>

                  {dispatchSummary.processed === 0 &&
                    dispatchSummary.pendingFutureCount > 0 && (
                      <button
                        type="button"
                        disabled={dispatching}
                        onClick={() => runSendReminders(true)}
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                      >
                        Forzar envío ahora (prueba)
                      </button>
                    )}
                </div>

                {dispatchSummary.items.length > 0 && (
                  <ul className="mt-4 divide-y divide-zinc-800/70 border-t border-zinc-800/70">
                    {dispatchSummary.items.map((item) => {
                      const linkKey = `link-${item.id}`;
                      const msgKey = `msg-${item.id}`;
                      return (
                        <li
                          key={item.id}
                          className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-100">
                              {item.customerName}{' '}
                              <span className="font-mono text-xs tabular-nums text-zinc-400">
                                · {item.customerPhone}
                              </span>
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-zinc-400">
                              {item.reviewLink}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(linkKey, item.reviewLink)
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 whitespace-nowrap shrink-0"
                            >
                              {copiedKey === linkKey ? (
                                <>
                                  <Check
                                    className="h-3.5 w-3.5 text-emerald-400"
                                    aria-hidden="true"
                                  />
                                  <span className="text-emerald-300">
                                    Enlace copiado
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span>Copiar enlace</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(msgKey, item.messagePreview)
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 whitespace-nowrap shrink-0"
                            >
                              {copiedKey === msgKey ? (
                                <>
                                  <Check
                                    className="h-3.5 w-3.5 text-emerald-400"
                                    aria-hidden="true"
                                  />
                                  <span className="text-emerald-300">
                                    Mensaje copiado
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span>Copiar mensaje</span>
                                </>
                              )}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          <ReviewRequestsTable requests={requests} />
        </div>
      ) : activeTab === 'feedback' ? (
        <PrivateFeedbackList items={initialFeedback} />
      ) : activeTab === 'settings' ? (
        <BusinessSettingsForm
          business={business}
          onUpdated={handleBusinessUpdated}
        />
      ) : (
        <SubscriptionPanel
          business={business}
          userEmail={userEmail}
          totalRequestsCount={requests.length}
          onUpdated={handleBusinessUpdated}
        />
      )}
    </div>
  );
}
