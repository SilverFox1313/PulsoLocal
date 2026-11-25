import { getComparablePhoneKey } from '@/lib/messaging/phone';
import type { ReviewRequestStatus } from '@/types/database';

export interface RequestHistoryRecord {
  id: string;
  business_id?: string;
  customer_name: string;
  customer_phone: string;
  status: ReviewRequestStatus;
  scheduled_for: string;
  created_at: string;
}

export interface PendingRequestDuplicateAlert {
  pendingRequestId: string;
  customerName: string;
  customerPhone: string;
  scheduledFor: string;
  previousCount: number;
  previousSentCount: number;
  latestStatus: ReviewRequestStatus;
  latestCreatedAt: string | null;
  latestScheduledFor: string | null;
  hasPriorSentOrCompleted: boolean;
}

export const REVIEW_STATUS_LABELS_ES: Record<ReviewRequestStatus, string> = {
  pending: 'Pendiente',
  processing: 'En proceso',
  sent: 'Enviada',
  clicked: 'Clic registrado',
  completed: 'Completada',
  failed: 'Fallida',
};

function getTimestampMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDispatchedOrCompletedStatus(status: ReviewRequestStatus): boolean {
  return status === 'sent' || status === 'clicked' || status === 'completed';
}

export function findPendingRequestsWithHistory(
  allRequests: RequestHistoryRecord[],
  options: {
    businessId?: string;
    onlyDueAsOfMs?: number;
    limitPending?: number;
  } = {}
): PendingRequestDuplicateAlert[] {
  const scopedRequests = options.businessId
    ? allRequests.filter(
        (item) => !item.business_id || item.business_id === options.businessId
      )
    : allRequests;

  if (scopedRequests.length === 0) {
    return [];
  }

  const byPhoneKey = new Map<string, RequestHistoryRecord[]>();

  for (const row of scopedRequests) {
    const phoneKey = getComparablePhoneKey(row.customer_phone);
    if (!phoneKey) continue;
    const list = byPhoneKey.get(phoneKey);
    if (list) {
      list.push(row);
    } else {
      byPhoneKey.set(phoneKey, [row]);
    }
  }

  let candidatePending = scopedRequests.filter(
    (item) => item.status === 'pending'
  );

  if (typeof options.onlyDueAsOfMs === 'number') {
    const cutoff = options.onlyDueAsOfMs;
    candidatePending = candidatePending.filter(
      (item) => getTimestampMs(item.scheduled_for) <= cutoff
    );
  }

  // Ordenar por fecha programada ascendente (igual que la cola de envíos)
  candidatePending.sort((a, b) => {
    const diff = getTimestampMs(a.scheduled_for) - getTimestampMs(b.scheduled_for);
    if (diff !== 0) return diff;
    return getTimestampMs(a.created_at) - getTimestampMs(b.created_at);
  });

  if (typeof options.limitPending === 'number' && options.limitPending > 0) {
    candidatePending = candidatePending.slice(0, options.limitPending);
  }

  const alerts: PendingRequestDuplicateAlert[] = [];

  for (const pendingRow of candidatePending) {
    const phoneKey = getComparablePhoneKey(pendingRow.customer_phone);
    if (!phoneKey) continue;

    const group = byPhoneKey.get(phoneKey) ?? [];
    const pendingCreatedMs = getTimestampMs(pendingRow.created_at);

    const priorMatches = group.filter((other) => {
      if (other.id === pendingRow.id) return false;
      if (other.status !== 'pending') {
        return true;
      }
      const otherCreatedMs = getTimestampMs(other.created_at);
      if (otherCreatedMs !== pendingCreatedMs) {
        return otherCreatedMs < pendingCreatedMs;
      }
      return other.id < pendingRow.id;
    });

    if (priorMatches.length === 0) {
      continue;
    }

    // Ordenar del más reciente al más antiguo; ante empate de timestamp, priorizar no-pending
    priorMatches.sort((a, b) => {
      const diff = getTimestampMs(b.created_at) - getTimestampMs(a.created_at);
      if (diff !== 0) return diff;
      if (a.status !== 'pending' && b.status === 'pending') return -1;
      if (a.status === 'pending' && b.status !== 'pending') return 1;
      return b.id.localeCompare(a.id);
    });

    const latest = priorMatches[0];
    const previousSentCount = priorMatches.filter((item) =>
      isDispatchedOrCompletedStatus(item.status)
    ).length;
    const hasPriorSentOrCompleted = previousSentCount > 0;

    alerts.push({
      pendingRequestId: pendingRow.id,
      customerName: pendingRow.customer_name,
      customerPhone: pendingRow.customer_phone,
      scheduledFor: pendingRow.scheduled_for,
      previousCount: priorMatches.length,
      previousSentCount,
      latestStatus: latest.status,
      latestCreatedAt: latest.created_at ?? null,
      latestScheduledFor: latest.scheduled_for ?? null,
      hasPriorSentOrCompleted,
    });
  }

  return alerts;
}
