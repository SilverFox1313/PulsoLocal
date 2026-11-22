'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  MessageSquareWarning,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import BusinessSettingsForm from '@/components/BusinessSettingsForm';
import CronCountdownIndicator from '@/components/CronCountdownIndicator';
import PrivateFeedbackList from '@/components/PrivateFeedbackList';
import ReviewRequestForm from '@/components/ReviewRequestForm';
import ReviewRequestsTable from '@/components/ReviewRequestsTable';
import SubscriptionPanel from '@/components/SubscriptionPanel';
import { createClient } from '@/lib/supabase/client';
import type {
  Business,
  PrivateFeedbackItem,
  ReviewRequest,
} from '@/types/database';

interface WhatsAppEnvStatus {
  hasPhoneNumberId: boolean;
  hasAccessToken: boolean;
  isConfigured: boolean;
}

interface DashboardWorkspaceProps {
  userEmail: string;
  initialBusiness: Business | null;
  initialRequests: ReviewRequest[];
  initialFeedback: PrivateFeedbackItem[];
  loadError?: string | null;
  whatsAppEnvStatus?: WhatsAppEnvStatus;
}

interface ProcessedReminderItem {
  id: string;
  customerName: string;
  customerPhone: string;
  reviewLink: string;
  messagePreview: string;
  deliveryMode: 'whatsapp_cloud' | 'simulated';
}

interface DispatchSummary {
  mode: 'whatsapp_cloud' | 'simulated';
  processed: number;
  failed: number;
  pendingFutureCount: number;
  items: ProcessedReminderItem[];
  errors?: Array<{ id: string; error: string }>;
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
    const remaining = Math.max(0, 7 - elapsedDays);
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
  whatsAppEnvStatus = {
    hasPhoneNumberId: false,
    hasAccessToken: false,
    isConfigured: false,
  },
}: DashboardWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>('requests');
  const [business, setBusiness] = useState<Business | null>(initialBusiness);
  const [requests, setRequests] = useState<ReviewRequest[]>(initialRequests);
  const [feedbackItems, setFeedbackItems] =
    useState<PrivateFeedbackItem[]>(initialFeedback);

  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSummary, setDispatchSummary] =
    useState<DispatchSummary | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const businessId = business?.id ?? null;

  const requestsByIdRef = useRef<Map<string, ReviewRequest>>(
    new Map(initialRequests.map((item) => [item.id, item]))
  );
  const localMutationTimestampsRef = useRef<Map<string, number>>(new Map());
  const manualDispatchActiveRef = useRef(false);
  const shouldFocusGoogleUrlRef = useRef(false);

  function markLocalMutation(requestId: string) {
    localMutationTimestampsRef.current.set(requestId, Date.now());
  }

  function wasLocallyMutated(requestId: string): boolean {
    const ts = localMutationTimestampsRef.current.get(requestId);
    if (!ts) return false;
    if (Date.now() - ts > 8000) {
      localMutationTimestampsRef.current.delete(requestId);
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (!businessId) {
      return;
    }

    let isMounted = true;
    let feedbackTimer: number | null = null;
    let lastVisibilitySyncAt = 0;
    const feedbackNotifiedAt = new Map<string, number>();
    const completedToastTimers = new Map<string, number>();

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    async function fetchFeedbackSilently(notifyForId?: string) {
      try {
        const { data, error } = await supabase
          .from('feedback')
          .select(
            'id, request_id, rating, comment, redirected_to_google, created_at, review_requests(customer_name, customer_phone)'
          )
          .eq('business_id', businessId)
          .order('created_at', { ascending: false });

        if (!isMounted || error || !data) {
          return;
        }

        const mapped: PrivateFeedbackItem[] = data.map((row) => {
          const linkedReq = Array.isArray(row.review_requests)
            ? row.review_requests[0]
            : row.review_requests;

          return {
            id: row.id,
            request_id: row.request_id,
            rating: row.rating,
            comment: row.comment,
            redirected_to_google: row.redirected_to_google,
            created_at: row.created_at,
            customer_name: linkedReq?.customer_name ?? 'Cliente',
            customer_phone: linkedReq?.customer_phone ?? '',
          };
        });

        setFeedbackItems(mapped);

        if (notifyForId) {
          const target = mapped.find((item) => item.id === notifyForId);
          if (target) {
            toast.info(
              `Nueva calificación (${target.rating}/5) recibida de ${target.customer_name}`
            );
          }
        }
      } catch {
        // Silencioso en segundo plano
      }
    }

    async function refreshAllSilently() {
      try {
        const [requestsRes, feedbackRes] = await Promise.all([
          supabase
            .from('review_requests')
            .select(
              'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
            )
            .eq('business_id', businessId)
            .order('created_at', { ascending: false }),
          supabase
            .from('feedback')
            .select(
              'id, request_id, rating, comment, redirected_to_google, created_at, review_requests(customer_name, customer_phone)'
            )
            .eq('business_id', businessId)
            .order('created_at', { ascending: false }),
        ]);

        if (!isMounted) {
          return;
        }

        if (!requestsRes.error && requestsRes.data) {
          const freshRequests = requestsRes.data as ReviewRequest[];
          requestsByIdRef.current = new Map(
            freshRequests.map((item) => [item.id, item])
          );
          setRequests(freshRequests);
        }

        if (!feedbackRes.error && feedbackRes.data) {
          const mapped: PrivateFeedbackItem[] = feedbackRes.data.map((row) => {
            const linkedReq = Array.isArray(row.review_requests)
              ? row.review_requests[0]
              : row.review_requests;

            return {
              id: row.id,
              request_id: row.request_id,
              rating: row.rating,
              comment: row.comment,
              redirected_to_google: row.redirected_to_google,
              created_at: row.created_at,
              customer_name: linkedReq?.customer_name ?? 'Cliente',
              customer_phone: linkedReq?.customer_phone ?? '',
            };
          });

          setFeedbackItems(mapped);
        }
      } catch {
        // Silencioso en segundo plano
      }
    }

    function scheduleFeedbackRefresh(notifyForId?: string) {
      if (feedbackTimer !== null) {
        window.clearTimeout(feedbackTimer);
      }
      feedbackTimer = window.setTimeout(() => {
        feedbackTimer = null;
        void fetchFeedbackSilently(notifyForId);
      }, 200);
    }

    const channel = supabase
      .channel(`pulsolocal-dashboard-${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'review_requests',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          if (!isMounted) {
            return;
          }

          if (payload.eventType === 'INSERT') {
            const inserted = payload.new as ReviewRequest;
            requestsByIdRef.current.set(inserted.id, inserted);
            setRequests((prev) =>
              prev.some((item) => item.id === inserted.id)
                ? prev.map((item) => (item.id === inserted.id ? inserted : item))
                : [inserted, ...prev]
            );
            return;
          }

          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as ReviewRequest;
            const previous = requestsByIdRef.current.get(updated.id);
            requestsByIdRef.current.set(updated.id, updated);

            setRequests((prev) => {
              const exists = prev.some((item) => item.id === updated.id);
              if (!exists) {
                return [updated, ...prev];
              }
              return prev.map((item) =>
                item.id === updated.id ? { ...item, ...updated } : item
              );
            });

            if (
              !manualDispatchActiveRef.current &&
              !wasLocallyMutated(updated.id)
            ) {
              if (previous?.status !== 'sent' && updated.status === 'sent') {
                toast.info(`Solicitud enviada a ${updated.customer_name}`);
              } else if (
                previous?.status !== 'completed' &&
                updated.status === 'completed'
              ) {
                const notifiedAt = feedbackNotifiedAt.get(updated.id);
                if (!notifiedAt || Date.now() - notifiedAt > 4000) {
                  const existingTimer = completedToastTimers.get(updated.id);
                  if (existingTimer !== undefined) {
                    window.clearTimeout(existingTimer);
                  }
                  const timer = window.setTimeout(() => {
                    completedToastTimers.delete(updated.id);
                    const fbAt = feedbackNotifiedAt.get(updated.id);
                    if (!fbAt || Date.now() - fbAt > 4000) {
                      toast.success(
                        `${updated.customer_name} completó su reseña`
                      );
                    }
                  }, 300);
                  completedToastTimers.set(updated.id, timer);
                }
              }
            }
            return;
          }

          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string } | null)?.id;
            if (deletedId) {
              requestsByIdRef.current.delete(deletedId);
              setRequests((prev) =>
                prev.filter((item) => item.id !== deletedId)
              );
            } else {
              void refreshAllSilently();
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'feedback',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          if (!isMounted) {
            return;
          }

          if (payload.eventType === 'INSERT') {
            const inserted = payload.new as {
              id?: string;
              request_id?: string;
              rating?: number;
            };

            if (inserted.request_id) {
              feedbackNotifiedAt.set(inserted.request_id, Date.now());
              const pendingCompletedTimer = completedToastTimers.get(
                inserted.request_id
              );
              if (pendingCompletedTimer !== undefined) {
                window.clearTimeout(pendingCompletedTimer);
                completedToastTimers.delete(inserted.request_id);
              }
            }

            const linkedRequest = inserted.request_id
              ? requestsByIdRef.current.get(inserted.request_id)
              : undefined;

            if (linkedRequest) {
              toast.info(
                `Nueva calificación${
                  typeof inserted.rating === 'number'
                    ? ` (${inserted.rating}/5)`
                    : ''
                } recibida de ${linkedRequest.customer_name}`
              );
              scheduleFeedbackRefresh();
            } else {
              scheduleFeedbackRefresh(inserted.id);
            }
            return;
          }

          scheduleFeedbackRefresh();
        }
      )
      .subscribe();

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const now = Date.now();
      if (now - lastVisibilitySyncAt < 1500) {
        return;
      }
      lastVisibilitySyncAt = now;
      void refreshAllSilently();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      isMounted = false;
      if (feedbackTimer !== null) {
        window.clearTimeout(feedbackTimer);
      }
      for (const timer of completedToastTimers.values()) {
        window.clearTimeout(timer);
      }
      completedToastTimers.clear();
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      void supabase.removeChannel(channel);
    };
  }, [businessId]);

  const negativeFeedbackCount = feedbackItems.filter(
    (item) => item.rating <= 3
  ).length;

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  function handleRequestCreated(newRequest: ReviewRequest) {
    markLocalMutation(newRequest.id);
    requestsByIdRef.current.set(newRequest.id, newRequest);
    setRequests((prev) =>
      prev.some((item) => item.id === newRequest.id)
        ? prev
        : [newRequest, ...prev]
    );
    setDispatchSummary(null);
  }

  function handleRequestUpdated(updatedRequest: ReviewRequest) {
    markLocalMutation(updatedRequest.id);
    requestsByIdRef.current.set(updatedRequest.id, updatedRequest);
    setRequests((prev) =>
      prev.map((item) =>
        item.id === updatedRequest.id ? updatedRequest : item
      )
    );
    setDispatchSummary(null);
    router.refresh();
  }

  function handleRequestDeleted(deletedId: string) {
    markLocalMutation(deletedId);
    requestsByIdRef.current.delete(deletedId);
    setRequests((prev) => prev.filter((item) => item.id !== deletedId));
    setDispatchSummary(null);
    router.refresh();
  }

  function handleBusinessUpdated(updated: Business) {
    setBusiness(updated);
  }

  function scrollToAndFocusGoogleUrl() {
    window.requestAnimationFrame(() => {
      const input = document.getElementById(
        'settings-google-url'
      ) as HTMLInputElement | null;
      if (!input) {
        return;
      }
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        input.focus({ preventScroll: true });
      }, 150);
    });
  }

  useEffect(() => {
    if (activeTab !== 'settings' || !shouldFocusGoogleUrlRef.current) {
      return;
    }

    shouldFocusGoogleUrlRef.current = false;
    scrollToAndFocusGoogleUrl();
  }, [activeTab]);

  function handleGoToGoogleUrlSetting() {
    if (activeTab === 'settings') {
      scrollToAndFocusGoogleUrl();
      return;
    }
    shouldFocusGoogleUrlRef.current = true;
    setActiveTab('settings');
  }

  async function handleCopyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.info(
        key.startsWith('link-')
          ? 'Enlace copiado al portapapeles'
          : 'Mensaje copiado al portapapeles'
      );
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  }

  async function runSendReminders(includeFuture = false) {
    setDispatchError(null);
    setDispatching(true);
    manualDispatchActiveRef.current = true;
    const toastId = toast.loading(
      includeFuture
        ? 'Enviando solicitudes pendientes...'
        : 'Verificando y enviando solicitudes pendientes...'
    );

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
        const errMsg =
          payload?.error ||
          'No se pudo ejecutar la verificación de envíos pendientes.';
        setDispatchError(errMsg);
        toast.error(errMsg, { id: toastId });
        manualDispatchActiveRef.current = false;
        setDispatching(false);
        return;
      }

      const sentIds = new Set(payload.items.map((item) => item.id));
      for (const id of sentIds) {
        markLocalMutation(id);
        const existing = requestsByIdRef.current.get(id);
        if (existing) {
          requestsByIdRef.current.set(id, { ...existing, status: 'sent' });
        }
      }
      manualDispatchActiveRef.current = false;

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
        errors: payload.errors,
      });

      if (payload.processed > 0 && payload.failed === 0) {
        const countLabel =
          payload.processed === 1
            ? '1 solicitud'
            : `${payload.processed} solicitudes`;
        toast.success(
          payload.mode === 'whatsapp_cloud'
            ? `${countLabel} ${
                payload.processed === 1 ? 'enviada' : 'enviadas'
              } por WhatsApp`
            : `${countLabel} ${
                payload.processed === 1 ? 'registrada' : 'registradas'
              } en modo de prueba`,
          { id: toastId }
        );
      } else if (payload.processed > 0 && payload.failed > 0) {
        toast.warning(
          `${payload.processed} enviadas y ${payload.failed} con error en WhatsApp`,
          { id: toastId }
        );
      } else if (payload.processed === 0 && payload.failed > 0) {
        toast.error(
          payload.errors?.[0]?.error ||
            'No se pudieron enviar los mensajes por WhatsApp.',
          { id: toastId }
        );
      } else {
        toast.info(
          payload.pendingFutureCount > 0
            ? `No hay envíos vencidos (${payload.pendingFutureCount} programadas a futuro)`
            : 'No hay solicitudes pendientes por enviar',
          { id: toastId }
        );
      }

      router.refresh();
    } catch {
      manualDispatchActiveRef.current = false;
      const errMsg =
        'Error de conexión al ejecutar la verificación de envíos.';
      setDispatchError(errMsg);
      toast.error(errMsg, { id: toastId });
    } finally {
      manualDispatchActiveRef.current = false;
      setDispatching(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="border-b border-slate-200 pb-8 dark:border-white/[0.04]">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 bg-clip-text text-transparent dark:from-orange-400 dark:via-amber-400 dark:to-orange-500">
              Bienvenido
            </span>
            <span className="ml-2 inline-block">👋</span>
          </h1>

          <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-800 sm:text-3xl dark:text-zinc-100">
            {business?.business_name || 'Mi Negocio'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-medium text-slate-900 dark:text-zinc-100">
              {userEmail}
            </span>
            {business && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Espera: {business.delay_minutes} min
                </span>
                <span aria-hidden="true">·</span>
                {business.google_review_url ? (
                  <span>Enlace de Google configurado</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleGoToGoogleUrlSetting}
                    className="cursor-pointer rounded-xs font-medium text-red-600 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:text-red-400"
                  >
                    Falta configurar enlace de Google
                  </button>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-medium tabular-nums text-slate-800 dark:text-zinc-200">
                  {getHeaderPlanLabel(business)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="mt-5">
          <div
            role="tablist"
            aria-label="Secciones del panel"
            className="grid w-full grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-xs transition-colors duration-300 ease-in-out md:inline-flex md:w-auto md:flex-nowrap md:items-center md:gap-1 shrink-0 dark:border-transparent dark:bg-[#27272E] dark:shadow-md dark:shadow-black/50"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'requests'}
              onClick={() => setActiveTab('requests')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'requests'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 hover:dark:bg-[#32323A] dark:hover:text-white'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Solicitudes</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'feedback'}
              onClick={() => setActiveTab('feedback')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'feedback'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 hover:dark:bg-[#32323A] dark:hover:text-white'
              }`}
            >
              <MessageSquareWarning className="h-4 w-4 shrink-0" aria-hidden="true" />
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
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 hover:dark:bg-[#32323A] dark:hover:text-white'
              }`}
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Configuración</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'subscription'}
              onClick={() => setActiveTab('subscription')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'subscription'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 hover:dark:bg-[#32323A] dark:hover:text-white'
              }`}
            >
              <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Suscripción</span>
            </button>
          </div>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{loadError}</span>
        </div>
      )}

      {business && !business.google_review_url && activeTab === 'requests' && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/40 dark:bg-[#1E1E24] dark:shadow-xl dark:shadow-black/50">
          <p className="text-sm text-amber-900 dark:text-amber-100">
            Aún no has agregado tu enlace directo de reseñas de Google Maps.
            Configúralo antes de enviar tus primeras invitaciones.
          </p>
          <button
            type="button"
            onClick={handleGoToGoogleUrlSetting}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-500/40 bg-white px-3.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:border-none dark:bg-[#27272E] dark:text-amber-300 hover:dark:bg-[#32323A] dark:shadow-sm dark:shadow-black/40 whitespace-nowrap shrink-0"
          >
            Configurar enlace
          </button>
        </div>
      )}

      {!business ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-xs dark:border-transparent dark:bg-[#1E1E24] dark:text-zinc-300 dark:shadow-2xl dark:shadow-black/60">
          No pudimos cargar el perfil de tu negocio en este momento. Recarga la
          página o contacta a soporte si el problema continúa.
        </section>
      ) : activeTab === 'requests' ? (
        <div className="space-y-8">
          <ReviewRequestForm
            delayMinutes={business.delay_minutes}
            onCreated={handleRequestCreated}
          />

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
                  Automatización de envíos
                </h2>
                <p className="mt-1 text-sm text-slate-600 tabular-nums dark:text-zinc-300">
                  {pendingCount === 0
                    ? 'No hay solicitudes en estado pendiente en este momento.'
                    : `${pendingCount} ${
                        pendingCount === 1
                          ? 'solicitud pendiente'
                          : 'solicitudes pendientes'
                      } esperando su hora programada.`}
                </p>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
                  Envío automático diario · Usa el botón manual para enviar al
                  instante.
                </p>
                <div>
                  <CronCountdownIndicator hasPendingRequests={pendingCount > 0} />
                </div>
              </div>

              <button
                type="button"
                disabled={dispatching}
                onClick={() => runSendReminders(false)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-orange-500 bg-transparent px-5 text-sm font-semibold shadow-xs transition-all hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {dispatching ? (
                  <>
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-orange-500 dark:text-orange-400"
                      aria-hidden="true"
                    />
                    <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                      Verificando envíos...
                    </span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400" aria-hidden="true" />
                    <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                      Verificar y Enviar Pendientes
                    </span>
                  </>
                )}
              </button>
            </div>

            {!whatsAppEnvStatus.isConfigured && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-semibold">
                    {whatsAppEnvStatus.hasPhoneNumberId ||
                    whatsAppEnvStatus.hasAccessToken
                      ? 'Conexión con WhatsApp incompleta'
                      : 'Envíos por WhatsApp en modo de prueba'}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200/90">
                    {!whatsAppEnvStatus.hasPhoneNumberId &&
                    !whatsAppEnvStatus.hasAccessToken
                      ? 'Los mensajes se registrarán en modo de prueba sin enviarse por WhatsApp hasta completar la conexión con la cuenta empresarial.'
                      : 'Faltan credenciales de WhatsApp por completar en el servidor. Contacta al administrador para activar los envíos reales.'}
                  </p>
                </div>
              </div>
            )}

            {dispatchError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                  aria-hidden="true"
                />
                <span>{dispatchError}</span>
              </div>
            )}

            {dispatchSummary && (
              <div className="mt-5 border-t border-slate-200 pt-5 dark:border-white/[0.04]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5 text-sm">
                    {dispatchSummary.processed === 0 &&
                    dispatchSummary.failed > 0 ? (
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                    )}
                    <div>
                      <p className="font-medium text-slate-900 tabular-nums dark:text-zinc-100">
                        {dispatchSummary.processed}{' '}
                        {dispatchSummary.processed === 1
                          ? 'solicitud procesada'
                          : 'solicitudes procesadas'}{' '}
                        ·{' '}
                        <span className="text-slate-600 dark:text-zinc-300">
                          {dispatchSummary.mode === 'whatsapp_cloud'
                            ? 'Enviado por WhatsApp'
                            : 'Registrado en modo de prueba'}
                        </span>
                      </p>
                      {dispatchSummary.failed > 0 && (
                        <div
                          role="alert"
                          className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200"
                        >
                          <p className="font-semibold">
                            {dispatchSummary.failed}{' '}
                            {dispatchSummary.failed === 1
                              ? 'envío no pudo completarse por WhatsApp:'
                              : 'envíos no pudieron completarse por WhatsApp:'}
                          </p>
                          {dispatchSummary.errors &&
                            dispatchSummary.errors.length > 0 && (
                              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                {dispatchSummary.errors.map((errItem) => (
                                  <li key={errItem.id}>{errItem.error}</li>
                                ))}
                              </ul>
                            )}
                        </div>
                      )}
                      {dispatchSummary.processed === 0 &&
                        dispatchSummary.pendingFutureCount > 0 && (
                          <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-zinc-300">
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
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-3.5 text-xs font-medium text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-200 disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-md dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
                      >
                        Enviar programadas ahora
                      </button>
                    )}
                </div>

                {dispatchSummary.items.length > 0 && (
                  <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200 dark:divide-white/[0.04] dark:border-transparent">
                    {dispatchSummary.items.map((item) => {
                      const linkKey = `link-${item.id}`;
                      const msgKey = `msg-${item.id}`;
                      return (
                        <li
                          key={item.id}
                          className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                              {item.customerName}{' '}
                              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-zinc-300">
                                · {item.customerPhone}
                              </span>
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-zinc-300">
                              {item.reviewLink}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(linkKey, item.reviewLink)
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-white whitespace-nowrap shrink-0"
                            >
                              {copiedKey === linkKey ? (
                                <>
                                  <Check
                                    className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                    aria-hidden="true"
                                  />
                                  <span className="text-emerald-700 dark:text-emerald-300">
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
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-white whitespace-nowrap shrink-0"
                            >
                              {copiedKey === msgKey ? (
                                <>
                                  <Check
                                    className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                    aria-hidden="true"
                                  />
                                  <span className="text-emerald-700 dark:text-emerald-300">
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

          <ReviewRequestsTable
            requests={requests}
            onRequestUpdated={handleRequestUpdated}
            onRequestDeleted={handleRequestDeleted}
          />
        </div>
      ) : activeTab === 'feedback' ? (
        <PrivateFeedbackList items={feedbackItems} />
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
