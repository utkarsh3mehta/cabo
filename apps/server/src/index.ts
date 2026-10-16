import { buildServer } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await buildServer(config);
  const log = server.app.log;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down; active games in memory will end');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await server.close();
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });

  const address = await server.listen();
  log.info({ address, env: config.env, publicOrigin: config.publicOrigin }, 'Cabo server listening');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
