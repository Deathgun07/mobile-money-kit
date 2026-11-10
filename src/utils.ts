// utils.ts — outils partagés : HTTP, lecture des notifications, signatures.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderUnavailableError, ValidationError } from './errors.js';
import type { IncomingRequest } from './types.js';

export type FetchLike = typeof fetch;

export interface HttpResult {
  status: number;
  text: string;
  json: any;
}

/** POST JSON. Réseau / timeout / 5xx → ProviderUnavailableError (bascule possible). */
export async function postJson(
  provider: string,
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderUnavailableError(`${provider} injoignable : ${(err as Error).message}`, {
      provider,
      details: err,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (res.status >= 500) {
    throw new ProviderUnavailableError(`${provider} a répondu HTTP ${res.status}`, {
      provider,
      code: String(res.status),
      details: json ?? text,
    });
  }
  return { status: res.status, text, json };
}

/** Lit un en-tête de façon insensible à la casse, quel que soit le framework. */
export function getHeader(headers: IncomingRequest['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() === lower) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * Normalise une notification en dictionnaire de chaînes.
 * Les paramètres de l'URL sont lus en premier, puis complétés / remplacés par
 * le corps : certains agrégateurs (XPAYE) envoient tout dans l'URL avec un
 * corps vide. Corps accepté : JSON (string ou objet), form-urlencoded (string
 * ou URLSearchParams).
 */
export function readFields(request: IncomingRequest): Record<string, string> {
  const { body } = request;
  const fields: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    fields[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  };

  queryParams(request.url).forEach((value, key) => put(key, value));

  if (body == null || body === '') return fields;
  if (body instanceof URLSearchParams) {
    body.forEach((value, key) => put(key, value));
    return fields;
  }
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(trimmed))) put(k, v);
        return fields;
      } catch {
        // pas du JSON : on tente le format formulaire
      }
    }
    new URLSearchParams(trimmed).forEach((value, key) => put(key, value));
    return fields;
  }
  for (const [k, v] of Object.entries(body)) put(k, v);
  return fields;
}

/**
 * Paramètres d'une URL, en réparant les valeurs dans lesquelles l'agrégateur a
 * collé un second « ?… ». XPAYE ajoute ses paramètres avec « ? » même si
 * notificationURL en contient déjà :
 *   /notify?provider=xpaye&nt=abc?merchantId=PP-1&amount=100
 * donne { provider: "xpaye", nt: "abc", merchantId: "PP-1", amount: "100" }.
 * Une clé déjà présente n'est jamais écrasée (la première occurrence gagne).
 */
export function queryParams(url: string | undefined): URLSearchParams {
  const out = new URLSearchParams();
  if (!url) return out;
  const index = url.indexOf('?');
  if (index === -1) return out;
  for (const [key, value] of new URLSearchParams(url.slice(index + 1).split('#')[0])) {
    const glued = value.indexOf('?');
    if (!out.has(key)) out.set(key, glued === -1 ? value : value.slice(0, glued));
    if (glued !== -1) {
      for (const [k2, v2] of new URLSearchParams(value.slice(glued + 1))) {
        if (!out.has(k2)) out.set(k2, v2);
      }
    }
  }
  return out;
}

export function hmacSha256Hex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Comparaison en temps constant (évite les attaques par mesure du temps de réponse). */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Ajoute (ou remplace) un paramètre dans une URL, en conservant le reste. */
export function withQueryParam(url: string, key: string, value: string): string {
  const [base, hash] = url.split('#', 2);
  const index = base.indexOf('?');
  const path = index === -1 ? base : base.slice(0, index);
  const params = new URLSearchParams(index === -1 ? '' : base.slice(index + 1));
  params.set(key, value);
  return `${path}?${params.toString()}${hash !== undefined ? `#${hash}` : ''}`;
}

export function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  // « 2 000 » ou « 2 000 » (espace insécable) : séparateurs de milliers retirés.
  const n = typeof value === 'string' ? Number(value.replace(/[\s\u00a0\u202f]/g, '')) : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function requireField(provider: string, value: unknown, name: string): void {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new ValidationError(`${provider} : le champ ${name} est obligatoire`, { provider });
  }
}

const SENSITIVE_FIELDS = new Set(['hashcode', 'signature', 'x-token', 'nt', 'apikey', 'token']);

/**
 * Copie des champs d'une notification, prête à être loguée : signatures et
 * jetons tronqués, adresses e-mail masquées.
 */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') out[key] = value;
    else if (SENSITIVE_FIELDS.has(key.toLowerCase())) out[key] = `${value.slice(0, 4)}…(masqué)`;
    else out[key] = value.replace(/^([^@\s]{2})[^@\s]*(@[^@\s]+)$/, '$1***$2');
  }
  return out;
}
