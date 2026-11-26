export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'inactive';

export type ReviewRequestStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'clicked'
  | 'completed'
  | 'failed';

export interface Business {
  id: string;
  user_id: string;
  business_name: string;
  google_review_url: string | null;
  normalized_google_review_url?: string | null;
  canonical_email?: string | null;
  trial_restricted_reason?: string | null;
  message_template: string;
  delay_minutes: number;
  subscription_status: SubscriptionStatus;
  created_at: string;
}

export interface ReviewRequest {
  id: string;
  business_id: string;
  customer_name: string;
  customer_phone: string;
  status: ReviewRequestStatus;
  whatsapp_message_id?: string | null;
  sent_at?: string | null;
  last_error?: string | null;
  attempts?: number;
  scheduled_for: string;
  created_at: string;
}

export interface Feedback {
  id: string;
  request_id: string;
  business_id: string;
  rating: number;
  comment: string | null;
  redirected_to_google: boolean;
  created_at: string;
}

export interface PublicReviewRequestData {
  request_id: string;
  customer_name: string;
  business_name: string;
  google_review_url: string | null;
  already_submitted: boolean;
  submitted_rating?: number | null;
  needs_private_comment?: boolean;
}

export interface PrivateFeedbackItem {
  id: string;
  request_id: string;
  rating: number;
  comment: string | null;
  redirected_to_google: boolean;
  created_at: string;
  customer_name: string;
  customer_phone: string;
}
