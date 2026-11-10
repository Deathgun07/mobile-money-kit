import type { IncomingRequest } from './types.js';
export type FetchLike = typeof fetch;
export interface HttpResult {
    status: number;
    text: string;
    json: any;
}
/** POST JSON. Réseau / timeout / 5xx → ProviderUnavailableError (bascule possible). */
export declare function postJson(provider: string, fetchImpl: FetchLike, url: string, body: unknown, options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
}): Promise<HttpResult>;
/** Lit un en-tête de façon insensible à la casse, quel que soit le framework. */
export declare function getHeader(headers: IncomingRequest['headers'], name: string): string | undefined;
/**
 * Normalise une notification en dictionnaire de chaînes.
 * Les paramètres de l'URL sont lus en premier, puis complétés / remplacés par
 * le corps : certains agrégateurs (XPAYE) envoient tout dans l'URL avec un
 * corps vide. Corps accepté : JSON (string ou objet), form-urlencoded (string
 * ou URLSearchParams).
 */
export declare function readFields(request: IncomingRequest): Record<string, string>;
/**
 * Paramètres d'une URL, en réparant les valeurs dans lesquelles l'agrégateur a
 * collé un second « ?… ». XPAYE ajoute ses paramètres avec « ? » même si
 * notificationURL en contient déjà :
 *   /notify?provider=xpaye&nt=abc?merchantId=PP-1&amount=100
 * donne { provider: "xpaye", nt: "abc", merchantId: "PP-1", amount: "100" }.
 * Une clé déjà présente n'est jamais écrasée (la première occurrence gagne).
 */
export declare function queryParams(url: string | undefined): URLSearchParams;
export declare function hmacSha256Hex(secret: string, data: string): string;
export declare function sha256Hex(data: string): string;
/** Comparaison en temps constant (évite les attaques par mesure du temps de réponse). */
export declare function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean;
/** Ajoute (ou remplace) un paramètre dans une URL, en conservant le reste. */
export declare function withQueryParam(url: string, key: string, value: string): string;
export declare function toNumber(value: unknown): number | undefined;
export declare function requireField(provider: string, value: unknown, name: string): void;
/**
 * Copie des champs d'une notification, prête à être loguée : signatures et
 * jetons tronqués, adresses e-mail masquées.
 */
export declare function redactFields(fields: Record<string, unknown>): Record<string, unknown>;
