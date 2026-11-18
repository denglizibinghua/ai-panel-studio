import { buildApp } from './app';
import { closeDb, getDb } from './db';
import { migrate } from './db/migrate';
import { createLlmOverride } from './llm';

const parsedPort = Number.parseInt(process.env.PORT ?? '8787', 10);
const port = Number.isNaN(parsedPort) ? 8787 : parsedPort;

const db = getDb();
migrate(db);
// FAKE_LLM=1 (E2E) swaps the transport, never the client (see llm/index.ts).
// Unset means `undefined`, so the routes keep their own key preflight.
const app = buildApp({ db, llm: createLlmOverride({ db }) });

async function main(): Promise<void> {
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`server listening on http://127.0.0.1:${port}`);
}

main().catch((error: unknown) => {
  console.error('server failed to start:', error);
  closeDb();
  process.exitCode = 1;
});

function shutdown(): void {
  void app.close().finally(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
