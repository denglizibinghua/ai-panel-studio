/**
 * Discussion lifecycle errors. Codes are the contract values from
 * openapi.yaml (ErrorCode) — routes only translate `code` to HTTP status.
 */
export type DiscussionErrorCode =
  | 'INVALID_INPUT'
  | 'DISCUSSION_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'TOO_MANY_RUNNING';

export class DiscussionError extends Error {
  readonly code: DiscussionErrorCode;

  constructor(code: DiscussionErrorCode, message: string) {
    super(message);
    this.name = 'DiscussionError';
    this.code = code;
  }
}
