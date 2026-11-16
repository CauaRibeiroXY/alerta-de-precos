import type {
  AlertTriggerEvent,
  BotCommand,
  PriceAlert,
  PriceResult,
} from '../types/index.js';

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBrl(value: number): string {
  return BRL_FORMATTER.format(value).replace(/\u00a0/g, ' ');
}

/**
 * Parses a Brazilian or decimal price string into a positive number rounded to 2 decimals.
 * Examples: "4.500,00" -> 4500, "2.199,90" -> 2199.9, "2000" -> 2000, "2199.90" -> 2199.9
 */
function parsePriceValue(raw: string): number | null {
  const cleaned = raw.trim().replace(/^r\$\s*/i, '').trim();
  if (!cleaned) return null;

  let normalized: string;
  if (cleaned.includes(',')) {
    // Brazilian format: dots are thousands separators, comma is decimal separator
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) {
    // Thousands separator without decimals, e.g. "4.500"
    normalized = cleaned.replace(/\./g, '');
  } else {
    normalized = cleaned;
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function parseAlertArgs(argsText: string): { query: string; targetPrice: number | null } | null {
  const trimmed = argsText.trim();
  if (!trimmed) return null;

  // 1) Explicit keyword or symbol before the price:
  //    e.g. "rtx 4060 ate 2000", "rtx 4060 até R$ 2.199,90", "rtx 4060 | 2000",
  //         "rtx 4060 < 2000", "rtx 4060 por 2000", "rtx 4060 preco: 2000"
  const explicitKeywordMatch = trimmed.match(
    /^(.+?)\s+(?:at[eé]|por|pre[cç]o:?|<|\|)\s*(?:r\$\s*)?(\d[\d.,]*)\s*$/i,
  );
  if (explicitKeywordMatch) {
    const query = explicitKeywordMatch[1].trim();
    const price = parsePriceValue(explicitKeywordMatch[2]);
    if (query && price !== null) {
      return { query, targetPrice: price };
    }
  }

  // 2) Explicit "R$" currency prefix before the price:
  //    e.g. "iphone 15 R$ 4.500,00" or "rtx 4060 R$ 2000"
  const currencyMatch = trimmed.match(/^(.+?)\s+r\$\s*(\d[\d.,]*)\s*$/i);
  if (currencyMatch) {
    const query = currencyMatch[1].trim();
    const price = parsePriceValue(currencyMatch[2]);
    if (query && price !== null) {
      return { query, targetPrice: price };
    }
  }

  // 3) Trailing formatted decimal price without keyword/R$:
  //    Only matches explicit decimal prices with comma (e.g. "2000,00", "1.200,00", "99,90")
  //    or 2-digit dot decimals with integer part >= 10 (e.g. "2000.00", "2199.90")
  //    so model numbers like "iphone 15", "rtx 4060", "usb 3.0" are never misread as prices.
  const decimalTrailingMatch = trimmed.match(
    /^(.+?)\s+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}|\d{2,}\.\d{2})\s*$/,
  );
  if (decimalTrailingMatch) {
    const query = decimalTrailingMatch[1].trim();
    const price = parsePriceValue(decimalTrailingMatch[2]);
    if (query && price !== null) {
      return { query, targetPrice: price };
    }
  }

  // Otherwise, entire argument is the product query and targetPrice is null (monitor any price drop)
  return { query: trimmed, targetPrice: null };
}

export function parseCommand(text: string): BotCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('!') && !trimmed.startsWith('/')) {
    return null;
  }

  const body = trimmed.slice(1).trim();
  if (!body) {
    return { type: 'unknown', raw: trimmed };
  }

  const firstSpaceIdx = body.search(/\s/);
  const commandName = (firstSpaceIdx === -1 ? body : body.slice(0, firstSpaceIdx)).toLowerCase();
  const rest = firstSpaceIdx === -1 ? '' : body.slice(firstSpaceIdx + 1).trim();

  switch (commandName) {
    case 'ajuda':
    case 'help':
      return { type: 'help' };

    case 'buscar':
    case 'busca': {
      const parsed = parseAlertArgs(rest);
      if (!parsed) return { type: 'unknown', raw: trimmed };
      return parsed.targetPrice !== null
        ? { type: 'search', query: parsed.query, maxPrice: parsed.targetPrice }
        : { type: 'search', query: parsed.query };
    }

    case 'alerta': {
      const parsed = parseAlertArgs(rest);
      if (!parsed) return { type: 'unknown', raw: trimmed };
      return { type: 'alert', query: parsed.query, targetPrice: parsed.targetPrice };
    }

    case 'lista':
    case 'alertas':
      return { type: 'list' };

    case 'remover':
    case 'del':
      if (!rest) return { type: 'unknown', raw: trimmed };
      return { type: 'remove', id: rest };

    case 'pausar':
      if (!rest) return { type: 'unknown', raw: trimmed };
      return { type: 'pause', id: rest };

    case 'retomar':
      if (!rest) return { type: 'unknown', raw: trimmed };
      return { type: 'resume', id: rest };

    case 'verificar':
    case 'checar':
      return { type: 'check-now' };

    default:
      return { type: 'unknown', raw: trimmed };
  }
}

export function formatHelpMessage(): string {
  return [
    '🤖 *Monitor de Preços — Comandos*',
    '',
    '• *!buscar <produto>* — Busca ofertas agora nas lojas',
    '  Ex: `!buscar rtx 4060`',
    '• *!alerta <produto> [preço]* — Cria alerta de preço',
    '  Ex: `!alerta iphone 15 ate 4500`',
    '  Ex: `!alerta rtx 4060 R$ 2.199,90`',
    '  Ex: `!alerta monitor lg 1.200,00`',
    '  Ex: `!alerta iphone 15` _(sem preço = avisa qualquer queda)_',
    '• *!lista* (ou *!alertas*) — Lista todos os alertas salvos',
    '• *!pausar <id>* — Pausa um alerta',
    '• *!retomar <id>* — Retoma um alerta pausado',
    '• *!remover <id>* (ou *!del <id>*) — Remove um alerta',
    '• *!verificar* (ou *!checar*) — Verifica todos os alertas agora',
    '• *!ajuda* — Mostra esta mensagem',
    '',
    '💡 _Dica: para produtos com números no nome (ex: iPhone 15, RTX 4060), use `ate`, `R$`, `|`, `<` ou centavos (`,00`) antes do valor._',
    '📝 _Mensagens sem `!` ou `/` são ignoradas para não atrapalhar suas anotações pessoais._',
  ].join('\n');
}

export function formatSearchResults(query: string, results: PriceResult[]): string {
  if (results.length === 0) {
    return `🔍 Nenhum resultado encontrado para *${query}*.`;
  }

  const lines: string[] = [`🔍 *Resultados para "${query}":*`, ''];

  results.forEach((item, index) => {
    lines.push(`${index + 1}. *${item.title}*`);
    lines.push(`   💰 ${formatBrl(item.price)} — ${item.store} (${item.source})`);
    lines.push(`   🔗 ${item.url}`);
    if (index < results.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
}

export function formatAlertList(alerts: PriceAlert[]): string {
  if (alerts.length === 0) {
    return '📭 Você ainda não tem alertas cadastrados.\nUse `!alerta <produto> ate <preço>` para criar um!';
  }

  const lines: string[] = [`📋 *Seus Alertas (${alerts.length}):*`, ''];

  alerts.forEach((alert, index) => {
    const status = alert.active ? '🟢 Ativo' : '⏸️ Pausado';
    const target =
      alert.targetPrice !== null ? `até ${formatBrl(alert.targetPrice)}` : 'qualquer queda';
    const lastPrice = alert.lastPrice !== null ? formatBrl(alert.lastPrice) : 'ainda não verificado';
    const lowest = alert.lowestPrice !== null ? ` | Menor: ${formatBrl(alert.lowestPrice)}` : '';

    lines.push(`${index + 1}. *[${alert.id}]* ${alert.query}`);
    lines.push(`   ${status} | Meta: ${target}`);
    lines.push(`   Último: ${lastPrice}${lowest}`);
    if (index < alerts.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
}

export function formatAlertNotification(event: AlertTriggerEvent): string {
  const { alert, bestResult, previousPrice, reason } = event;

  let header = '🔔 *Alerta de Preço!*';
  if (reason === 'target-reached') {
    header = '🎯 *Meta de preço atingida!*';
  } else if (reason === 'price-dropped') {
    header = '📉 *O preço caiu!*';
  } else if (reason === 'initial-price') {
    header = '🏷️ *Primeiro preço encontrado!*';
  }

  const lines: string[] = [
    header,
    '',
    `📦 *Alerta:* ${alert.query} (\`${alert.id}\`)`,
    `🛒 *Produto:* ${bestResult.title}`,
    `💰 *Preço atual:* ${formatBrl(bestResult.price)}`,
  ];

  if (previousPrice !== null) {
    lines.push(`📊 *Preço anterior:* ${formatBrl(previousPrice)}`);
  }

  if (alert.targetPrice !== null) {
    lines.push(`🎯 *Sua meta:* ${formatBrl(alert.targetPrice)}`);
  }

  lines.push(`🏪 *Loja:* ${bestResult.store} (${bestResult.source})`);
  lines.push(`🔗 ${bestResult.url}`);

  return lines.join('\n');
}
