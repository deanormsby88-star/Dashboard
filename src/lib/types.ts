export type BusinessKey = "heya" | "jic" | "personal";

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Business {
  id: string;
  user_id: string;
  key: BusinessKey;
  name: string;
  todoist_project_id: string | null;
}

export type ProcessingStatus = "pending" | "processing" | "processed" | "failed";

export interface Meeting {
  id: string;
  user_id: string;
  business_id: string | null;
  source_system: string;
  source_record_id: string;
  source_url: string | null;
  title: string;
  meeting_date: Date | null;
  notes: string;
  transcript: string;
  summary: string | null;
  recommended_follow_up: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export type TaskStatus =
  | "suggested"
  | "approved"
  | "rejected"
  | "sent"
  | "created"
  | "completed"
  | "failed";

export type TaskOrigin = "action_item" | "commitment" | "both" | "waiting_on" | "manual";

export interface Task {
  id: string;
  user_id: string;
  business_id: string | null;
  meeting_id: string | null;
  title: string;
  description: string;
  priority: number;
  due_date: Date | null;
  labels: string[];
  origin: TaskOrigin;
  status: TaskStatus;
  status_error: string | null;
  confidence: number | null;
  todoist_task_id: string | null;
  todoist_task_url: string | null;
  source_system: string | null;
  source_record_id: string | null;
  source_url: string | null;
  dedup_key: string;
  ai_run_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export type CommitmentDirection = "by_dean" | "to_dean";

export interface Commitment {
  id: string;
  user_id: string;
  business_id: string | null;
  meeting_id: string | null;
  direction: CommitmentDirection;
  text: string;
  person_id: string | null;
  person_name: string | null;
  company: string | null;
  date_made: Date | null;
  due_date: Date | null;
  status: "open" | "done" | "cancelled";
  confidence: number | null;
  linked_task_id: string | null;
  source_system: string | null;
  source_record_id: string | null;
  source_url: string | null;
  dedup_key: string;
  created_at: Date;
}

export interface Risk {
  id: string;
  user_id: string;
  business_id: string | null;
  meeting_id: string | null;
  description: string;
  severity: "low" | "medium" | "high";
  status: "open" | "mitigated" | "closed";
  confidence: number | null;
  source_url: string | null;
  created_at: Date;
}

export interface Decision {
  id: string;
  user_id: string;
  meeting_id: string | null;
  text: string;
  decided_on: Date | null;
  confidence: number | null;
  created_at: Date;
}

export interface Person {
  id: string;
  user_id: string;
  full_name: string;
  role: string | null;
  organization: string | null;
  email: string | null;
  created_at: Date;
}

export interface Interaction {
  id: string;
  user_id: string;
  person_id: string | null;
  person_name: string | null;
  meeting_id: string | null;
  kind: string;
  summary: string;
  occurred_at: Date;
  confidence: number | null;
  created_at: Date;
}

export type WebhookEventStatus = "received" | "processed" | "duplicate" | "failed";

export interface WebhookEvent {
  id: string;
  endpoint: string;
  idempotency_key: string;
  payload: unknown;
  raw_body: string | null;
  status: WebhookEventStatus;
  error: string | null;
  received_at: Date;
  processed_at: Date | null;
}
