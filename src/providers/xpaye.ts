// providers/xpaye.ts — XPAYE (ex-Paiement Pro, paiementpro.net).
//
// Sources : documentation publique paiementpro.net (api-php, api-java-script,
// sandbox.paiementpro.net) et une intégration en production (canal WAVECI).
//
// Points importants :
//  - XPAYE n'a PAS d'API publique de vérification de statut : la notification
//    (notificationURL) est la seule source d'information.
//  - La notification arrive dans l'URL (corps vide), et XPAYE ajoute ses
//    paramètres avec un « ? » même si notificationURL en contient déjà un :
//      /notify?provider=xpaye&nt=<jeton>?merchantId=PP-…&amount=100&…
//    queryParams() (utils.ts) répare ce format.
//  - Formule du `hashcode`, confirmée sur un vrai paiement :
//      SHA-256( referenceNumber | amount | merchantId | clé secrète )  (hex)
//    ⚠️ Le statut (responsecode) n'est PAS signé : un paiement échoué et un
//    paiement réussi de même référence et même montant ont le même hashcode.
//  - Le JETON SECRET ajouté à notificationURL (paramètre `nt`) est donc la
//    seule preuve qui couvre aussi le statut : cette URL est transmise
//    serveur-à-serveur et n'est jamais montrée au client.
//
// Règles appliquées par parseWebhook() :
//   1. un hashcode présent mais invalide → notification rejetée ;
//   2. jeton valide → authentifiée ('notify-token') ;
//   3. sinon hashcode valide → authentifiée ('signature'), sauf si
//      requireNotifyToken est actif (défaut dès que webhookSecret est fourni).

import { PaymentError, ValidationError, WebhookVerificationError } from '../errors.js';
import { channelInfo } from '../channels.js';
import { detectCiOperator } from '../phone.js';
import type {
  Channel,
  Currency,
  IncomingRequest,
  PaymentProvider,
  PaymentRequest,
  PaymentSession,
  WebhookEvent,
} from '../types.js';
import {
  type FetchLike,
  hmacSha256Hex,
  postJson,
  readFields,
  requireField,
  safeEqual,
  sha256Hex,
  toNumber,
  withQueryParam,
} from '../utils.js';

/**
 * Codes de canaux XPAYE, tels que listés par la documentation officielle :
 * https://sandbox.paiementpro.net/test-sandbox.html (relevé du 2026-11-10).
 * Le kit n'en fournit pas d'autres : tout code supplémentaire est ajouté par
 * l'intégrateur via `channelCodes`, sous sa responsabilité.
 */
export const XPAYE_CHANNEL_CODES: Partial<Record<Channel, string>> = {
  ORANGE_CI: 'OMCIV2',
  MTN_CI: 'MOMOCI',
  MOOV_CI: 'FLOOZ',
  WAVE_CI: 'WAVECI',
  ORANGE_SN: 'OMSN',
  WAVE_SN: 'WAVESN',
  ORANGE_BF: 'OMBF',
  ORANGE_ML: 'OMML',
  MTN_BJ: 'MOMOBJ',
  MOOV_BJ: 'FLOOZBJ',
  MOOV_TG: 'MOOTG',
  TOGOCEL_TG: 'TOGOCEL',
  AIRTEL_NE: 'AIRTELNG',
  // Libellé officiel « ORANGE GUINEE BISSAU » (le code OMGN évoque plutôt la Guinée).
  ORANGE_GW: 'OMGN',
  ORANGE_CM: 'OMCM',
  MTN_CM: 'MOMOCM',
  CARD: 'CARD',
  PAYPAL: 'PAYPAL',
};


const CURRENCY_CODES: Partial<Record<Currency, string>> = { XOF: '952', XAF: '950' };

const NOTIFY_TOKEN_PARAM = 'nt';
const DEFAULT_NOTIFY_TOKEN_PREFIX = 'xpaye-notify:';

/**
 * hashcode XPAYE = SHA-256(referenceNumber|amount|merchantId|secretKey), en hex.
 * Les valeurs sont prises telles que reçues (pas de reformatage du montant).
 */
export function computeXpayeHashcode(fields: Record<string, unknown>, secretKey: string): string {
  return sha256Hex(
    [fields.referenceNumber, fields.amount, fields.merchantId, secretKey].map((v) => String(v ?? '')).join('|')
  );
}

export interface XpayeOptions {
  /** Identifiant marchand XPAYE (ex: 'PP-XXXX'). */
  merchantId: string;
  /**
   * Secret propre à TON serveur (32+ caractères aléatoires), utilisé pour
   * signer le jeton ajouté à notificationURL. Ne le partage avec personne.
   * Sans lui, aucune notification ne peut être authentifiée.
   */
  webhookSecret?: string;
  /**
   * Clé secrète marchand fournie par XPAYE : active la vérification intégrée
   * du `hashcode`. Elle est courte : ne la réutilise pas comme webhookSecret.
   */
  secretKey?: string;
  /**
   * Exiger le jeton `nt` pour authentifier une notification (le hashcode seul
   * ne suffit plus). Défaut : true si webhookSecret est fourni.
   * Sans jeton, un hashcode récupéré sur une tentative ÉCHOUÉE permettrait de
   * forger une notification de succès (le statut n'est pas signé).
   */
  requireNotifyToken?: boolean;
  /** Utiliser l'environnement de test sandbox.paiementpro.net. */
  sandbox?: boolean;
  /** URL complète de l'endpoint d'initialisation (si XPAYE la change). */
  initUrl?: string;
  /**
   * Préfixe signé dans le jeton : HMAC(webhookSecret, prefix + référence).
   * Défaut : 'xpaye-notify:'. Mettre 'notify:' pour reprendre les paiements
   * en cours d'une intégration XPAYE maison qui utilisait ce format.
   */
  notifyTokenPrefix?: string;
  /**
   * Surcharger / compléter les codes de canaux (null retire un canal).
   * Un code non confirmé par XPAYE est à vérifier par l'intégrateur.
   */
  channelCodes?: Partial<Record<Channel, string | null>>;
  /**
   * Vérification personnalisée du champ `hashcode` (remplace celle de
   * `secretKey`, si XPAYE change de formule). Retourne true si valide.
   */
  verifyHashcode?: (fields: Record<string, string>) => boolean | Promise<boolean>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class XpayeProvider implements PaymentProvider {
  readonly name = 'xpaye';
  readonly supportedChannels: readonly Channel[];
  private readonly options: XpayeOptions;
  private readonly codes: Partial<Record<Channel, string>>;

  constructor(options: XpayeOptions) {
    if (!options.merchantId) throw new ValidationError('xpaye : merchantId est obligatoire', { provider: 'xpaye' });
    if (options.webhookSecret !== undefined && options.webhookSecret.length < 32) {
      throw new ValidationError('xpaye : webhookSecret doit faire au moins 32 caractères', { provider: 'xpaye' });
    }
    if (options.requireNotifyToken && !options.webhookSecret) {
      throw new ValidationError('xpaye : requireNotifyToken exige webhookSecret', { provider: 'xpaye' });
    }
    this.options = options;
    const codes: Partial<Record<Channel, string>> = { ...XPAYE_CHANNEL_CODES };
    for (const [channel, code] of Object.entries(options.channelCodes ?? {}) as [Channel, string | null | undefined][]) {
      if (code) codes[channel] = code;
      else delete codes[channel];
    }
    this.codes = codes;
    // ALL / MOBILE_MONEY : acceptés si l'opérateur peut être déduit du numéro.
    this.supportedChannels = [...(Object.keys(this.codes) as Channel[]), 'ALL', 'MOBILE_MONEY'];
  }

  private get initUrl(): string {
    if (this.options.initUrl) return this.options.initUrl;
    const host = this.options.sandbox ? 'https://sandbox.paiementpro.net' : 'https://www.paiementpro.net';
    return `${host}/webservice/onlinepayment/init/curl-init.php`;
  }

  /** Jeton d'authentification de la notification pour une référence donnée. */
  notifyToken(reference: string): string | null {
    if (!this.options.webhookSecret) return null;
    const prefix = this.options.notifyTokenPrefix ?? DEFAULT_NOTIFY_TOKEN_PREFIX;
    return hmacSha256Hex(this.options.webhookSecret, `${prefix}${reference}`);
  }

  private resolveChannel(request: PaymentRequest): string {
    const channel = request.channel ?? 'ALL';
    if (channel === 'ALL' || channel === 'MOBILE_MONEY') {
      const detected = request.customer.phone ? detectCiOperator(request.customer.phone) : null;
      if (!detected || !this.codes[detected]) {
        throw new ValidationError(
          `xpaye exige un canal précis (${Object.keys(this.codes).join(', ')}) : ` +
            'indique `channel` ou un numéro ivoirien d\'un opérateur activé',
          { provider: this.name }
        );
      }
      return this.codes[detected]!;
    }
    const code = this.codes[channel];
    if (!code) throw new ValidationError(`xpaye ne supporte pas le canal ${channel}`, { provider: this.name });
    return code;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentSession> {
    const currency = request.currency ?? 'XOF';
    const currencyCode = CURRENCY_CODES[currency];
    if (!currencyCode) throw new ValidationError(`xpaye ne supporte pas la devise ${currency}`, { provider: this.name });
    const expected = channelInfo(request.channel ?? 'ALL')?.currency;
    if (expected && expected !== currency) {
      throw new ValidationError(`xpaye : le canal ${request.channel} exige la devise ${expected} (reçu ${currency})`, {
        provider: this.name,
      });
    }
    requireField(this.name, request.customer.email, 'customer.email');
    requireField(this.name, request.customer.phone, 'customer.phone');

    const token = this.notifyToken(request.reference);
    const notificationURL = token
      ? withQueryParam(request.notifyUrl, NOTIFY_TOKEN_PARAM, token)
      : request.notifyUrl;

    const body = {
      merchantId: this.options.merchantId,
      amount: request.amount,
      description: request.description.slice(0, 100),
      channel: this.resolveChannel(request),
      countryCurrencyCode: currencyCode,
      referenceNumber: request.reference,
      customerEmail: request.customer.email,
      customerFirstName: request.customer.firstName,
      customerLastname: request.customer.lastName,
      customerPhoneNumber: request.customer.phone,
      notificationURL,
      returnURL: request.returnUrl,
      // La référence est aussi glissée dans returnContext : XPAYE ne renvoie pas
      // toujours referenceNumber directement.
      returnContext: JSON.stringify({ ref: request.reference, data: request.metadata ?? null }),
    };

    const res = await postJson(this.name, this.options.fetch ?? fetch, this.initUrl, body, {
      timeoutMs: this.options.timeoutMs,
    });

    if (res.status >= 400 || !res.json?.success || typeof res.json?.url !== 'string') {
      throw new PaymentError(`xpaye : échec de l'initialisation — ${res.json?.message ?? `HTTP ${res.status}`}`, {
        provider: this.name,
        code: 'INIT_FAILED',
        details: res.json ?? res.text,
      });
    }

    return { provider: this.name, reference: request.reference, paymentUrl: res.json.url, raw: res.json };
  }

  async parseWebhook(request: IncomingRequest): Promise<WebhookEvent> {
    const { [NOTIFY_TOKEN_PARAM]: receivedToken, ...fields } = readFields(request);
    const reference = extractReference(fields);
    if (!reference) {
      throw new ValidationError('xpaye : notification sans référence', { provider: this.name });
    }
    if (fields.merchantId && fields.merchantId !== this.options.merchantId) {
      throw new ValidationError('xpaye : merchantId de la notification inattendu', { provider: this.name });
    }

    const hashValid = await this.checkHashcode(fields);
    if (hashValid === false) {
      throw new WebhookVerificationError(`xpaye : hashcode invalide pour ${reference}`, { provider: this.name });
    }

    const requireToken = this.options.requireNotifyToken ?? Boolean(this.options.webhookSecret);
    let verifiedBy: WebhookEvent['verifiedBy'];
    if (safeEqual(receivedToken, this.notifyToken(reference))) verifiedBy = 'notify-token';
    else if (hashValid && !requireToken) verifiedBy = 'signature';

    return {
      provider: this.name,
      reference,
      status: xpayeStatus(fields.responsecode),
      amount: toNumber(fields.amount),
      currency: fields.countryCurrencyCode === '952' ? 'XOF' : fields.countryCurrencyCode === '950' ? 'XAF' : undefined,
      method: fields.channel,
      operatorReference: fields.transactionId || fields.transactiondt || undefined,
      verified: verifiedBy !== undefined,
      verifiedBy,
      // Le jeton `nt` est retiré : ces champs finissent souvent en base.
      fields,
    };
  }

  /** true / false si le hashcode a pu être vérifié, undefined sinon (absent ou aucune clé). */
  private async checkHashcode(fields: Record<string, string>): Promise<boolean | undefined> {
    if (!fields.hashcode) return undefined;
    if (this.options.verifyHashcode) return Boolean(await this.options.verifyHashcode(fields));
    if (!this.options.secretKey) return undefined;
    return safeEqual(computeXpayeHashcode(fields, this.options.secretKey), fields.hashcode.toLowerCase());
  }
}

/** responsecode XPAYE : '0' = réussi, '-1' = échoué ; toute autre valeur reste en attente. */
function xpayeStatus(code: string | undefined): WebhookEvent['status'] {
  const value = String(code ?? '').trim();
  if (value === '0') return 'success';
  if (value === '-1') return 'failed';
  return 'pending';
}

function extractReference(fields: Record<string, string>): string | null {
  if (fields.referenceNumber) return fields.referenceNumber;
  if (fields.returnContext) {
    try {
      const ctx = JSON.parse(fields.returnContext);
      // 'ref' : format du kit ; 'reference' / 'reference_number' : intégrations
      // XPAYE maison antérieures (paiements en cours lors d'une migration).
      for (const key of ['ref', 'reference', 'reference_number']) {
        if (ctx && typeof ctx[key] === 'string' && ctx[key]) return ctx[key];
      }
    } catch {
      // returnContext non JSON : ignoré
    }
  }
  return null;
}
