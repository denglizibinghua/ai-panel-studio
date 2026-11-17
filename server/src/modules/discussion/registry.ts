/**
 * Per-app registry of live runs, keyed by discussion id. `cancel` aborts the
 * controller; the runner checks the signal before every write, and every
 * turn-writing transaction re-checks `status='running'`, so a cancel that lands
 * mid-LLM-call still cannot produce another turn (AC-1.24).
 */
export interface RunRegistry {
  /** Registers a run; aborts a stale controller for the same discussion, if any. */
  start(discussionId: number): AbortController;
  abort(discussionId: number): void;
  /** Removes the entry only if it still points at this controller. */
  finish(discussionId: number, controller: AbortController): void;
  isActive(discussionId: number): boolean;
}

export function createRunRegistry(): RunRegistry {
  const runs = new Map<number, AbortController>();

  return {
    start(discussionId) {
      runs.get(discussionId)?.abort();
      const controller = new AbortController();
      runs.set(discussionId, controller);
      return controller;
    },
    abort(discussionId) {
      runs.get(discussionId)?.abort();
    },
    finish(discussionId, controller) {
      if (runs.get(discussionId) === controller) {
        runs.delete(discussionId);
      }
    },
    isActive(discussionId) {
      const controller = runs.get(discussionId);
      return controller !== undefined && !controller.signal.aborted;
    },
  };
}
