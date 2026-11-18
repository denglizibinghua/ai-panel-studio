import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ai-panel/shared': path.resolve(__dirname, '../shared/schemas/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Hardening for the one-off `ELIFECYCLE Test failed` seen after S10.
    //
    // Captured on 2026-11-18 (log: final-check-1) as an **unhandled rejection**,
    // not a test assertion:
    //   Error: Channel closed
    //     at target.send (node:internal/child_process:777)
    //     at ProcessWorker.send (tinypool@1.1.1/dist/index.js:140)
    //     at MessagePort.<anonymous> (tinypool@1.1.1/dist/index.js:149)
    // i.e. tinypool tried to post a queued message to a worker whose IPC channel
    // had already closed during per-file teardown. `fileParallelism: false` was
    // tried first and still reproduced it, so the trigger is worker *recycling*,
    // not concurrent load. Keeping one fork for the whole run removes the
    // per-file channel close; `isolate` stays on so module/env state is still
    // reset between files. No test retries: a real failure still fails.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
