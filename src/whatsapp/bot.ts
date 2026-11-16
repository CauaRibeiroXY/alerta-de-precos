import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeWASocket,
  useMultiFileAuthState,
  type Contact,
  type WAMessage,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { AlertStore, MonitorConfig, PriceSearcher } from '../types/index.js';
import {
  formatAlertList,
  formatBrl,
  formatHelpMessage,
  formatSearchResults,
  parseCommand,
} from './commands.js';

const MAX_TRACKED_SENT_IDS = 500;
const RECONNECT_BASE_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 30000;

export interface WhatsAppBotDeps {
  config: MonitorConfig;
  store: AlertStore;
  searcher: PriceSearcher;
  onTriggerCheckNow: () => Promise<void>;
}

export interface WhatsAppBot {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendSelfMessage(text: string): Promise<void>;
}

export function extractMessageText(
  msg: Pick<WAMessage, 'message'> | { message?: proto.IMessage | null },
): string {
  const content = msg.message;
  if (!content) return '';

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.ephemeralMessage?.message?.conversation ||
    content.ephemeralMessage?.message?.extendedTextMessage?.text ||
    ''
  );
}

export function isSelfChatJid(
  remoteJid: string | null | undefined,
  user: Pick<Contact, 'id' | 'lid' | 'jid'> | undefined,
): boolean {
  if (!remoteJid || !user) return false;

  if (
    remoteJid.endsWith('@g.us') ||
    remoteJid === 'status@broadcast' ||
    remoteJid.endsWith('@newsletter')
  ) {
    return false;
  }

  const normalizedRemote = jidNormalizedUser(remoteJid);
  const remoteUserPart = normalizedRemote.split('@')[0];

  const candidateJids = [user.id, user.lid, user.jid].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  for (const candidate of candidateJids) {
    const normalizedCandidate = jidNormalizedUser(candidate);
    if (normalizedRemote === normalizedCandidate) {
      return true;
    }

    const candidateUserPart = normalizedCandidate.split('@')[0];
    if (remoteUserPart && candidateUserPart && remoteUserPart === candidateUserPart) {
      return true;
    }
  }

  return false;
}

export function createWhatsAppBot(deps: WhatsAppBotDeps): WhatsAppBot {
  const { config, store, searcher, onTriggerCheckNow } = deps;
  const logger = pino({ level: config.logLevel });

  const sentMessageIds = new Set<string>();
  let sock: WASocket | null = null;
  let lastSelfJid: string | null = null;
  let isStopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  function trackSentMessageId(id: string | null | undefined): void {
    if (!id) return;
    if (sentMessageIds.size >= MAX_TRACKED_SENT_IDS) {
      const oldest = sentMessageIds.values().next().value;
      if (oldest !== undefined) {
        sentMessageIds.delete(oldest);
      }
    }
    sentMessageIds.add(id);
  }

  function resolveSelfTargetJid(): string | null {
    if (lastSelfJid) return lastSelfJid;
    if (sock?.user?.id) return jidNormalizedUser(sock.user.id);
    return null;
  }

  async function sendText(jid: string, text: string): Promise<void> {
    if (!sock) {
      logger.warn('Tentativa de enviar mensagem sem socket ativo.');
      return;
    }

    const sent = await sock.sendMessage(jid, { text });
    trackSentMessageId(sent?.key?.id);
  }

  async function sendSelfMessage(text: string): Promise<void> {
    const targetJid = resolveSelfTargetJid();
    if (!targetJid || !sock) {
      logger.warn('WhatsApp ainda não está conectado para enviar notificação.');
      return;
    }

    await sendText(targetJid, text);
  }

  async function handleCommandMessage(remoteJid: string, text: string): Promise<void> {
    const cmd = parseCommand(text);
    if (!cmd) return;

    try {
      switch (cmd.type) {
        case 'help': {
          await sendText(remoteJid, formatHelpMessage());
          break;
        }

        case 'search': {
          const priceLabel =
            cmd.maxPrice !== undefined ? ` até *${formatBrl(cmd.maxPrice)}*` : '';
          await sendText(remoteJid, `🔍 Buscando *${cmd.query}*${priceLabel}...`);
          const fetchLimit =
            cmd.maxPrice !== undefined
              ? Math.max(config.maxSearchResults * 3, 15)
              : config.maxSearchResults;
          const rawResults = await searcher.search(cmd.query, {
            limit: fetchLimit,
          });
          const results = (
            cmd.maxPrice !== undefined
              ? rawResults.filter((item) => item.price <= cmd.maxPrice!)
              : rawResults
          ).slice(0, config.maxSearchResults);
          await sendText(remoteJid, formatSearchResults(cmd.query, results));
          break;
        }

        case 'alert': {
          const created = await store.create({
            query: cmd.query,
            targetPrice: cmd.targetPrice,
          });
          const targetDesc =
            created.targetPrice !== null
              ? `até *${formatBrl(created.targetPrice)}*`
              : '_qualquer queda de preço_';
          await sendText(
            remoteJid,
            [
              `✅ Alerta criado com sucesso!`,
              `🆔 ID: \`${created.id}\``,
              `📦 Produto: *${created.query}*`,
              `🎯 Meta: ${targetDesc}`,
            ].join('\n'),
          );
          break;
        }

        case 'list': {
          const alerts = await store.list();
          await sendText(remoteJid, formatAlertList(alerts));
          break;
        }

        case 'remove': {
          const removed = await store.remove(cmd.id);
          await sendText(
            remoteJid,
            removed
              ? `🗑️ Alerta \`${cmd.id}\` removido.`
              : `⚠️ Alerta \`${cmd.id}\` não encontrado.`,
          );
          break;
        }

        case 'pause': {
          const updated = await store.update(cmd.id, { active: false });
          await sendText(
            remoteJid,
            updated
              ? `⏸️ Alerta \`${cmd.id}\` (*${updated.query}*) pausado.`
              : `⚠️ Alerta \`${cmd.id}\` não encontrado.`,
          );
          break;
        }

        case 'resume': {
          const updated = await store.update(cmd.id, { active: true });
          await sendText(
            remoteJid,
            updated
              ? `▶️ Alerta \`${cmd.id}\` (*${updated.query}*) retomado.`
              : `⚠️ Alerta \`${cmd.id}\` não encontrado.`,
          );
          break;
        }

        case 'check-now': {
          await sendText(remoteJid, '🔄 Verificando todos os alertas ativos agora...');
          await onTriggerCheckNow();
          await sendText(remoteJid, '✅ Verificação concluída.');
          break;
        }

        case 'unknown': {
          await sendText(
            remoteJid,
            `❓ Comando não reconhecido: \`${cmd.raw}\`\nEnvie \`!ajuda\` para ver os comandos disponíveis.`,
          );
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, cmd }, 'Erro ao processar comando');
      await sendText(remoteJid, `❌ Ocorreu um erro ao executar o comando: ${message}`);
    }
  }

  function scheduleReconnect(): void {
    if (isStopped || reconnectTimer) return;

    reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );

    console.log(`[WhatsApp] Reconectando em ${Math.round(delay / 1000)}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isStopped) {
        void connect();
      }
    }, delay);
  }

  async function connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      browser: ['Monitor de Precos', 'Desktop', '1.0.0'],
    });

    sock = socket;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n[WhatsApp] Escaneie o QR Code abaixo no seu celular:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        reconnectAttempts = 0;
        if (socket.user?.id) {
          lastSelfJid = jidNormalizedUser(socket.user.id);
        }
        console.log('[WhatsApp] Conectado com sucesso! Envie !ajuda no chat consigo mesmo.');
      }

      if (connection === 'close') {
        if (isStopped) return;

        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          console.error(
            `[WhatsApp] Sessão desconectada (loggedOut). Apague a pasta "${config.authDir}" e reinicie para escanear o QR Code novamente.`,
          );
          return;
        }

        scheduleReconnect();
      }
    });

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        const msgId = msg.key.id;
        if (msgId && sentMessageIds.has(msgId)) {
          continue;
        }

        if (msg.key.fromMe !== true) {
          continue;
        }

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || !isSelfChatJid(remoteJid, socket.user)) {
          continue;
        }

        const text = extractMessageText(msg);
        if (!text.trim()) continue;

        lastSelfJid = remoteJid;
        await handleCommandMessage(remoteJid, text);
      }
    });
  }

  async function start(): Promise<void> {
    isStopped = false;
    await connect();
  }

  async function stop(): Promise<void> {
    isStopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (sock) {
      try {
        sock.end(undefined);
      } catch (err) {
        logger.debug({ err }, 'Erro ao encerrar socket WhatsApp');
      }
      sock = null;
    }
  }

  return {
    start,
    stop,
    sendSelfMessage,
  };
}
