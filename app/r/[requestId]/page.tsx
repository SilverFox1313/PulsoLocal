import PublicReviewFlow from '@/components/PublicReviewFlow';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isValidUuid } from '@/lib/validation/uuid';
import type { PublicReviewRequestData } from '@/types/database';

export const dynamic = 'force-dynamic';

interface PublicReviewPageProps {
  params: Promise<{ requestId: string }>;
}

async function fetchPublicReviewRequest(
  requestId: string
): Promise<{ data: PublicReviewRequestData | null; error?: string }> {
  if (!isValidUuid(requestId, { strictVersion: true })) {
    return { data: null, error: 'invalid_id' };
  }

  const adminClient = createAdminClient();
  if (adminClient) {
    const { data: reqRow, error: reqError } = await adminClient
      .from('review_requests')
      .select('id, customer_name, status, business_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !reqRow) {
      return { data: null, error: 'not_found' };
    }

    const [{ data: businessRow }, { data: feedbackRow }] = await Promise.all([
      adminClient
        .from('businesses')
        .select('id, business_name, google_review_url')
        .eq('id', reqRow.business_id)
        .maybeSingle(),
      adminClient
        .from('feedback')
        .select('id, rating, comment')
        .eq('request_id', requestId)
        .maybeSingle(),
    ]);

    if (!businessRow) {
      return { data: null, error: 'not_found' };
    }

    const needsPrivateComment = Boolean(
      feedbackRow && feedbackRow.rating <= 3 && feedbackRow.comment === null
    );

    return {
      data: {
        request_id: reqRow.id,
        customer_name: reqRow.customer_name,
        status: reqRow.status,
        business_id: businessRow.id,
        business_name: businessRow.business_name,
        google_review_url: businessRow.google_review_url,
        already_submitted: reqRow.status === 'completed' || Boolean(feedbackRow),
        submitted_rating: feedbackRow?.rating ?? null,
        needs_private_comment: needsPrivateComment,
      },
    };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { data: null, error: 'not_configured' };
  }

  const { data, error } = await supabase.rpc('get_public_review_request', {
    p_request_id: requestId,
  });

  if (error) {
    return { data: null, error: 'rpc_error' };
  }

  if (!data) {
    return { data: null, error: 'not_found' };
  }

  return { data: data as PublicReviewRequestData };
}

async function checkIsBusinessOwner(businessId: string): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) {
    return false;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const adminClient = createAdminClient();
  if (adminClient) {
    const { data: bizRow } = await adminClient
      .from('businesses')
      .select('user_id')
      .eq('id', businessId)
      .maybeSingle();

    return Boolean(bizRow && bizRow.user_id === user.id);
  }

  const { data: ownedBiz } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', user.id)
    .maybeSingle();

  return Boolean(ownedBiz);
}

export default async function PublicReviewPage({
  params,
}: PublicReviewPageProps) {
  const { requestId } = await params;
  const { data, error } = await fetchPublicReviewRequest(requestId);
  const isOwner = data ? await checkIsBusinessOwner(data.business_id) : false;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 px-4 py-12 text-slate-900 transition-colors duration-200 dark:bg-black dark:text-zinc-100">
      <main className="flex flex-1 items-center justify-center">
        {data ? (
          <PublicReviewFlow data={data} isOwner={isOwner} />
        ) : (
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
              {error === 'invalid_id'
                ? 'Enlace no válido'
                : error === 'rpc_error'
                ? 'No se pudo cargar la encuesta'
                : 'Solicitud no encontrada'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              {error === 'invalid_id'
                ? 'El identificador de esta invitación no tiene un formato válido.'
                : error === 'rpc_error'
                ? 'No pudimos cargar esta invitación en este momento. Intenta recargar la página en unos segundos.'
                : 'Es posible que este enlace haya expirado o no exista.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
