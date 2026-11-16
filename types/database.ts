export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'inactive';

export type ReviewRequestStatus =
  | 'pending'
  | 'sent'
  | 'clicked'
  | 'completed';

export interface Business {
  id: string;
  user_id: string;
  business_name: string;
  google_review_url: string | null;
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
