import { describe, expect, it } from 'vitest';
import {
  formatAlertList,
  formatAlertNotification,
  formatBrl,
  formatHelpMessage,
  formatSearchResults,
  parseCommand,
} from './commands.js';
import type { AlertTriggerEvent, PriceAlert, PriceResult } from '../types/index.js';

describe('parseCommand', () => {
  it('returns null for normal messages without ! or / prefix', () => {
    expect(parseCommand('comprar leite e pão')).toBeNull();
    expect(parseCommand('anotação pessoal: iphone 15 ate 4500')).toBeNull();
    expect(parseCommand('   olá mundo   ')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('parses help commands with ! or / and case-insensitively', () => {
    expect(parseCommand('!ajuda')).toEqual({ type: 'help' });
    expect(parseCommand('/HELP')).toEqual({ type: 'help' });
    expect(parseCommand('  !Ajuda  ')).toEqual({ type: 'help' });
  });

  it('parses search commands', () => {
    expect(parseCommand('!buscar rtx 4060')).toEqual({
      type: 'search',
      query: 'rtx 4060',
    });
    expect(parseCommand('/busca iphone 15 pro max')).toEqual({
      type: 'search',
      query: 'iphone 15 pro max',
    });
    expect(parseCommand('!buscar s25 até 3200')).toEqual({
      type: 'search',
      query: 's25',
      maxPrice: 3200,
    });
  });

  it('parses alert commands without confusing product model numbers with prices', () => {
    expect(parseCommand('!alerta iphone 15')).toEqual({
      type: 'alert',
      query: 'iphone 15',
      targetPrice: null,
    });
    expect(parseCommand('!alerta rtx 4060')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: null,
    });
    expect(parseCommand('!alerta ssd 1tb')).toEqual({
      type: 'alert',
      query: 'ssd 1tb',
      targetPrice: null,
    });
    expect(parseCommand('!alerta monitor lg')).toEqual({
      type: 'alert',
      query: 'monitor lg',
      targetPrice: null,
    });
    expect(parseCommand('!alerta caixa de som 2.1')).toEqual({
      type: 'alert',
      query: 'caixa de som 2.1',
      targetPrice: null,
    });
  });

  it('parses alert commands with explicit price indicators and formatted values', () => {
    expect(parseCommand('!alerta iphone 15 ate 4500')).toEqual({
      type: 'alert',
      query: 'iphone 15',
      targetPrice: 4500,
    });
    expect(parseCommand('!alerta iphone 15 até R$ 4.500,00')).toEqual({
      type: 'alert',
      query: 'iphone 15',
      targetPrice: 4500,
    });
    expect(parseCommand('!alerta rtx 4060 R$ 2.199,90')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: 2199.9,
    });
    expect(parseCommand('!alerta monitor lg 1.200,00')).toEqual({
      type: 'alert',
      query: 'monitor lg',
      targetPrice: 1200,
    });
    expect(parseCommand('!alerta rtx 4060 2000,00')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: 2000,
    });
    expect(parseCommand('!alerta rtx 4060 2000.00')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: 2000,
    });
    expect(parseCommand('!alerta rtx 4060 | 2000')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: 2000,
    });
    expect(parseCommand('!alerta rtx 4060 < 2000')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: 2000,
    });
    expect(parseCommand('!alerta rtx 4060 preco: 2000')).toEqual({
      type: 'alert',
      query: 'rtx 4060',
      targetPrice: 2000,
    });
    expect(parseCommand('/alerta ps5 por 3500')).toEqual({
      type: 'alert',
      query: 'ps5',
      targetPrice: 3500,
    });
  });

  it('parses list, remove, pause, resume, and check-now commands', () => {
    expect(parseCommand('!lista')).toEqual({ type: 'list' });
    expect(parseCommand('/ALERTAS')).toEqual({ type: 'list' });

    expect(parseCommand('!remover abc123')).toEqual({ type: 'remove', id: 'abc123' });
    expect(parseCommand('/del xyz-1')).toEqual({ type: 'remove', id: 'xyz-1' });

    expect(parseCommand('!pausar abc123')).toEqual({ type: 'pause', id: 'abc123' });
    expect(parseCommand('!retomar abc123')).toEqual({ type: 'resume', id: 'abc123' });

    expect(parseCommand('!verificar')).toEqual({ type: 'check-now' });
    expect(parseCommand('/CHECAR')).toEqual({ type: 'check-now' });
  });

  it('returns unknown for unrecognized or incomplete ! / commands', () => {
    expect(parseCommand('!comandoinexistente')).toEqual({
      type: 'unknown',
      raw: '!comandoinexistente',
    });
    expect(parseCommand('!buscar')).toEqual({
      type: 'unknown',
      raw: '!buscar',
    });
    expect(parseCommand('!remover')).toEqual({
      type: 'unknown',
      raw: '!remover',
    });
  });
});

describe('formatters', () => {
  it('formats BRL currency consistently', () => {
    expect(formatBrl(1200)).toBe('R$ 1.200,00');
    expect(formatBrl(2199.9)).toBe('R$ 2.199,90');
    expect(formatBrl(45.5)).toBe('R$ 45,50');
  });

  it('formats help message containing key commands', () => {
    const help = formatHelpMessage();
    expect(help).toContain('!buscar');
    expect(help).toContain('!alerta');
    expect(help).toContain('!lista');
    expect(help).toContain('!verificar');
  });

  it('formats search results when empty and non-empty', () => {
    expect(formatSearchResults('rtx 4060', [])).toContain('Nenhum resultado');

    const results: PriceResult[] = [
      {
        title: 'Placa de Vídeo RTX 4060 8GB',
        price: 1999.9,
        currency: 'BRL',
        source: 'mercado-livre',
        store: 'Loja Oficial',
        url: 'https://example.com/rtx',
      },
    ];
    const formatted = formatSearchResults('rtx 4060', results);
    expect(formatted).toContain('Placa de Vídeo RTX 4060 8GB');
    expect(formatted).toContain('R$ 1.999,90');
    expect(formatted).toContain('Loja Oficial');
    expect(formatted).toContain('https://example.com/rtx');
  });

  it('formats alert list when empty and with items', () => {
    expect(formatAlertList([])).toContain('não tem alertas');

    const alerts: PriceAlert[] = [
      {
        id: 'al-1',
        query: 'iphone 15',
        targetPrice: 4500,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastCheckedAt: null,
        lastPrice: 4800,
        lowestPrice: 4700,
        lastResultUrl: null,
        lastResultTitle: null,
        lastResultStore: null,
        lastNotifiedAt: null,
      },
      {
        id: 'al-2',
        query: 'monitor lg',
        targetPrice: null,
        active: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastCheckedAt: null,
        lastPrice: null,
        lowestPrice: null,
        lastResultUrl: null,
        lastResultTitle: null,
        lastResultStore: null,
        lastNotifiedAt: null,
      },
    ];

    const text = formatAlertList(alerts);
    expect(text).toContain('[al-1]');
    expect(text).toContain('iphone 15');
    expect(text).toContain('R$ 4.500,00');
    expect(text).toContain('Ativo');
    expect(text).toContain('[al-2]');
    expect(text).toContain('Pausado');
    expect(text).toContain('qualquer queda');
  });

  it('formats alert notifications for different trigger reasons', () => {
    const event: AlertTriggerEvent = {
      alert: {
        id: 'al-1',
        query: 'rtx 4060',
        targetPrice: 2000,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastCheckedAt: '2026-01-02T00:00:00.000Z',
        lastPrice: 1950,
        lowestPrice: 1950,
        lastResultUrl: 'https://example.com/rtx',
        lastResultTitle: 'RTX 4060 Galax',
        lastResultStore: 'Kabum',
        lastNotifiedAt: null,
      },
      bestResult: {
        title: 'RTX 4060 Galax',
        price: 1950,
        currency: 'BRL',
        source: 'buscape',
        store: 'Kabum',
        url: 'https://example.com/rtx',
      },
      previousPrice: 2200,
      reason: 'target-reached',
    };

    const msg = formatAlertNotification(event);
    expect(msg).toContain('Meta de preço atingida');
    expect(msg).toContain('R$ 1.950,00');
    expect(msg).toContain('R$ 2.200,00');
    expect(msg).toContain('R$ 2.000,00');
    expect(msg).toContain('Kabum');
    expect(msg).toContain('https://example.com/rtx');
  });
});
