import { redirect } from 'next/navigation';
import DashboardHeader from '@/components/DashboardHeader';
import DashboardWorkspace from '@/components/DashboardWorkspace';
import { getWhatsAppEnvStatus } from '@/lib/messaging/send-reminder';
import { analyzeEmailForTrialAbuse } from '@/lib/subscription/trial';
import { createClient } from '@/lib/supabase/server';
import { validateAndSanitizeTemplateName } from '@/lib/validation/messaging-safety';
import type {
  Business,
  PrivateFeedbackItem,
  ReviewRequest,
} from '@/types/database';

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

  let business: Business | null = null;
  let requests: ReviewRequest[] = [];
  let feedbackItems: PrivateFeedbackItem[] = [];
  let loadError: string | null = null;

  const { data: existingBusiness, error: businessError } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (businessError) {
    loadError =
      'No se pudo cargar la configuración del negocio desde Supabase.';
  } else if (existingBusiness) {
    business = existingBusiness as Business;
  } else {
    const rawMetadataName =
      typeof user.user_metadata?.business_name === 'string'
        ? user.user_metadata.business_name
        : '';
    const sanitizedName = validateAndSanitizeTemplateName(
      rawMetadataName,
      'nombre del negocio'
    );
    const metadataName = sanitizedName.ok ? sanitizedName.value : 'Mi Negocio';

    const emailCheck = analyzeEmailForTrialAbuse(user.email ?? '');
    const initialStatus = emailCheck?.hasSubaddressing
      ? 'inactive'
      : 'trialing';

    const { data: createdBusiness, error: createError } = await supabase
      .from('businesses')
      .insert({
        user_id: user.id,
        business_name: metadataName,
        subscription_status: initialStatus,
        ...(emailCheck?.canonicalEmail
          ? { canonical_email: emailCheck.canonicalEmail }
          : {}),
      })
      .select('*')
      .single();

    if (createError) {
      loadError =
        'No se pudo inicializar el perfil de tu negocio en este momento. Recarga la página o contacta a soporte si el problema continúa.';
    } else {
      business = createdBusiness as Business;
    }
  }

  if (business) {
    const [requestsRes, feedbackRes] = await Promise.all([
      supabase
        .from('review_requests')
        .select(
          'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
        )
        .eq('business_id', business.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('feedback')
        .select(
          'id, request_id, rating, comment, redirected_to_google, created_at, review_requests(customer_name, customer_phone)'
        )
        .eq('business_id', business.id)
        .order('created_at', { ascending: false }),
    ]);

    if (requestsRes.error) {
      loadError =
        loadError ?? 'No se pudo cargar el historial de solicitudes.';
    } else if (requestsRes.data) {
      requests = requestsRes.data as ReviewRequest[];
    }

    if (!feedbackRes.error && feedbackRes.data) {
      feedbackItems = feedbackRes.data.map((row) => {
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
    }
  }

  const whatsAppEnvStatus = getWhatsAppEnvStatus();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 ease-in-out dark:bg-black dark:text-zinc-100">
      <DashboardHeader />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <DashboardWorkspace
          userEmail={user.email ?? ''}
          initialBusiness={business}
          initialRequests={requests}
          initialFeedback={feedbackItems}
          loadError={loadError}
          whatsAppEnvStatus={whatsAppEnvStatus}
        />
      </main>
    </div>
  );
}
