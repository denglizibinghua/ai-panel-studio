import type { AgentState, DiscussionStatus, Guest } from '@ai-panel/shared';

/**
 * Client-side mirrors of the snake_case HTTP payloads (AGENTS §6.10).
 *
 * The server (`server/src/modules/discussion/service.ts`) is the authority; this
 * file must never import server code and must never import zod — `@ai-panel/shared`
 * is consumed with `import type` only so zod stays out of the browser bundle.
 *
 * Field names are copied verbatim from the contract. No camel↔snake mapping layer
 * exists anywhere in `web/src/api` or `web/src/stores`.
 */

export type DiscussionErrorCode =
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_UPSTREAM_ERROR'
  | 'ALL_SPEAKERS_FAILED';

export interface DiscussionSummary {
  id: number;
  topic: string;
  status: DiscussionStatus;
  expert_count: number;
  guest_count: number;
  expert_color_ids: string[];
  summary_text: string | null;
  updated_at: string;
}

export interface DiscussionDetail extends DiscussionSummary {
  session_id: string | null;
  error_code: DiscussionErrorCode | null;
  last_event_seq: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  guests: Guest[];
}

/** One `agent_status` row as the UI needs it; `updated_seq` = the frame id. */
export interface AgentStatusView {
  state: AgentState;
  focus: string | null;
  updated_seq: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

/** `POST /api/discussions/{id}/guests/generate` (openapi.yaml). */
export interface GenerateGuestsResponse {
  discussion_id: number;
  status: 'draft';
  guests: Guest[];
}

/** `POST /api/discussions/{id}/guests/confirm` (openapi.yaml). */
export interface ConfirmGuestsResponse {
  discussion_id: number;
  status: 'ready';
  guests: Guest[];
}

/** `POST /api/discussions/{id}/start` (openapi.yaml). */
export interface StartDiscussionResponse {
  id: number;
  status: 'running';
  started_at: string;
}

/** `POST /api/discussions/{id}/cancel` (openapi.yaml). */
export interface CancelDiscussionResponse {
  id: number;
  status: 'cancelled';
  finished_at: string;
  error_code: null;
}

/** `POST /api/discussions/{id}/retry-summary` (S9, failed → finished). */
export interface RetrySummaryResponse {
  id: number;
  status: 'finished';
  summary_text: string;
  finished_at: string;
}
