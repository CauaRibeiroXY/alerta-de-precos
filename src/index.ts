import { loadConfig } from './config.js';
import { createPriceMonitor } from './monitor/priceMonitor.js';
import { createPriceSearcher } from './scrapers/index.js';
import { createJsonAlertStore } from './storage/alertStore.js';
import { createWhatsAppBot } from './whatsapp/bot.js';
import { formatAlertNotification } from './whatsapp/commands.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = createJsonAlertStore(config.dataDir);
  const searcher = createPriceSearcher();

  let monitor: ReturnType<typeof createPriceMonitor>;

  const bot = createWhatsAppBot({
    config,
    store,
    searcher,
    onTriggerCheckNow: async () => {
      await monitor.checkAll();
    },
  });

  monitor = createPriceMonitor({
    store,
    searcher,
    cooldownMinutes: config.alertCooldownMinutes,
    notifier: async (event) => {
      await bot.sendSelfMessage(formatAlertNotification(event));
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n[App] Recebido ${signal}. Encerrando com segurança...`);
    monitor.stop();
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  console.log('[App] Iniciando Monitor de Preços...');
  await bot.start();
  monitor.start(config.checkIntervalMinutes);
  console.log(
    `[App] Agendador iniciado (intervalo: ${config.checkIntervalMinutes} min, cooldown: ${config.alertCooldownMinutes} min).`,
  );
}

main().catch((err) => {
  console.error('[App] Erro fatal na inicialização:', err);
  process.exit(1);
});
