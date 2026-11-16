import Link from 'next/link';
import { redirect } from 'next/navigation';
import DashboardWorkspace from '@/components/DashboardWorkspace';
import SignOutButton from '@/components/SignOutButton';
import { createClient } from '@/lib/supabase/server';
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
    .select(
      'id, user_id, business_name, google_review_url, message_template, delay_minutes, subscription_status, created_at'
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (businessError) {
    loadError =
      'No se pudo cargar la configuración del negocio desde Supabase.';
  } else if (existingBusiness) {
    business = existingBusiness as Business;
  } else {
    const metadataName =
      typeof user.user_metadata?.business_name === 'string' &&
      user.user_metadata.business_name.trim().length > 0
        ? user.user_metadata.business_name.trim()
        : 'Mi Negocio';

    const { data: createdBusiness, error: createError } = await supabase
      .from('businesses')
      .insert({
        user_id: user.id,
        business_name: metadataName,
      })
      .select(
        'id, user_id, business_name, google_review_url, message_template, delay_minutes, subscription_status, created_at'
      )
      .single();

    if (createError) {
      loadError =
        'No se encontró tu negocio y no pudo crearse automáticamente. Verifica las tablas y políticas RLS en Supabase.';
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

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <Link
            href="/dashboard"
            className="text-lg font-bold tracking-tight text-zinc-50 whitespace-nowrap shrink-0"
          >
            PulsoLocal
          </Link>

          <div className="flex items-center shrink-0">
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <DashboardWorkspace
          userEmail={user.email ?? ''}
          initialBusiness={business}
          initialRequests={requests}
          initialFeedback={feedbackItems}
          loadError={loadError}
        />
      </main>
    </div>
  );
}
