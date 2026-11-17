import { buildApp } from './app';
import { closeDb, getDb } from './db';
import { migrate } from './db/migrate';

const parsedPort = Number.parseInt(process.env.PORT ?? '8787', 10);
const port = Number.isNaN(parsedPort) ? 8787 : parsedPort;

const db = getDb();
migrate(db);
const app = buildApp({ db });

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
