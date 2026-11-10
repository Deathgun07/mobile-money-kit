// providers/cinetpay.ts — CinetPay (API Checkout v2).
// Source : docs.cinetpay.com (initialisation, notification, HMAC, vérification).
//
// CinetPay a une API de statut : le client (PaymentClient.handleWebhook)
// reconfirme donc TOUJOURS le paiement auprès de CinetPay, même si la
// notification est correctement signée.

import { PaymentError, ValidationError, WebhookVerificationError } from '../errors.js';
import type {
  Channel,
  Currency,
  IncomingRequest,
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentSession,
  WebhookEvent,
} from '../types.js';
import { type FetchLike, getHeader, hmacSha256Hex, postJson, readFields, safeEqual, toNumber } from '../utils.js';

const SUPPORTED_CURRENCIES: Currency[] = ['XOF', 'XAF', 'GNF', 'CDF', 'USD'];

/** Ordre de concaténation officiel des champs pour le x-token (HMAC-SHA256). */
const HMAC_FIELDS = [
  'cpm_site_id',
  'cpm_trans_id',
  'cpm_trans_date',
  'cpm_amount',
  'cpm_currency',
  'signature',
  'payment_method',
  'cel_phone_num',
  'cpm_phone_prefixe',
  'cpm_language',
  'cpm_version',
  'cpm_payment_config',
  'cpm_page_action',
  'cpm_custom',
  'cpm_designation',
  'cpm_error_message',
] as const;

const PENDING_STATUSES = new Set(['WAITING_FOR_CUSTOMER', 'WAITING_CUSTOMER_PAYMENT', 'WAITING_CUSTOMER_TO_VALIDATE', 'PENDING']);
const PENDING_CODES = new Set(['662', '623']);

export interface CinetPayOptions {
  apiKey: string;
  siteId: string;
  /** Clé secrète (menu Intégrations du back-office) : active la vérification du x-token. */
  secretKey?: string;
  /** Langue de la page de paiement. Défaut : 'fr'. */
  lang?: 'fr' | 'en';
  /** Défaut : 'https://api-checkout.cinetpay.com/v2'. */
  apiUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class CinetPayProvider implements PaymentProvider {
  readonly name = 'cinetpay';
  // Chez CinetPay, l'opérateur est choisi par le client sur la page de paiement :
  // un canal opérateur précis est traduit en MOBILE_MONEY.
  readonly supportedChannels: readonly Channel[] = [
    'ALL', 'MOBILE_MONEY', 'CARD', 'ORANGE_CI', 'MTN_CI', 'MOOV_CI', 'WAVE_CI',
  ];
  private readonly options: CinetPayOptions;

  constructor(options: CinetPayOptions) {
    if (!options.apiKey || !options.siteId) {
      throw new ValidationError('cinetpay : apiKey et siteId sont obligatoires', { provider: 'cinetpay' });
    }
    this.options = options;
  }

  private url(path: string): string {
    return `${(this.options.apiUrl ?? 'https://api-checkout.cinetpay.com/v2').replace(/\/$/, '')}${path}`;
  }

  private post(path: string, body: unknown) {
    return postJson(this.name, this.options.fetch ?? fetch, this.url(path), body, {
      // CinetPay rejette les requêtes sans User-Agent (code 1010).
      headers: { 'User-Agent': 'mobile-money-kit' },
      timeoutMs: this.options.timeoutMs,
    });
  }

  async createPayment(request: PaymentRequest): Promise<PaymentSession> {
    const currency = request.currency ?? 'XOF';
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new ValidationError(`cinetpay ne supporte pas la devise ${currency}`, { provider: this.name });
    }
    if (currency !== 'USD' && request.amount % 5 !== 0) {
      throw new ValidationError('cinetpay : le montant doit être un multiple de 5', { provider: this.name });
    }

    const channel = request.channel ?? 'ALL';
    const channels = channel === 'ALL' || channel === 'WAVE_CI' ? 'ALL' : channel === 'CARD' ? 'CREDIT_CARD' : 'MOBILE_MONEY';
    const c = request.customer;

    const body: Record<string, unknown> = {
      apikey: this.options.apiKey,
      site_id: this.options.siteId,
      transaction_id: request.reference,
      amount: request.amount,
      currency,
      // CinetPay refuse certains caractères spéciaux dans la description.
      description: request.description.replace(/[#/$_&]/g, ' ').trim(),
      notify_url: request.notifyUrl,
      return_url: request.returnUrl,
      channels,
      lang: this.options.lang ?? 'fr',
      metadata: request.metadata,
      customer_id: c.id,
      customer_name: c.lastName,
      customer_surname: c.firstName,
      customer_email: c.email,
      customer_phone_number: c.phone,
      customer_country: c.country,
    };
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];

    const res = await this.post('/payment', body);
    const data = res.json;
    if (String(data?.code) !== '201' || typeof data?.data?.payment_url !== 'string') {
      throw new PaymentError(
        `cinetpay : échec de l'initialisation — ${data?.message ?? `HTTP ${res.status}`}${data?.description ? ` (${data.description})` : ''}`,
        { provider: this.name, code: data?.code !== undefined ? String(data.code) : 'INIT_FAILED', details: data ?? res.text }
      );
    }
    return {
      provider: this.name,
      reference: request.reference,
      paymentUrl: data.data.payment_url,
      providerToken: data.data.payment_token,
      raw: data,
    };
  }

  async getStatus(reference: string): Promise<PaymentResult> {
    const res = await this.post('/payment/check', {
      apikey: this.options.apiKey,
      site_id: this.options.siteId,
      transaction_id: reference,
    });
    const json = res.json;
    if (!json || json.code === undefined) {
      throw new PaymentError(`cinetpay : réponse de statut illisible (HTTP ${res.status})`, {
        provider: this.name,
        details: res.text,
      });
    }
    const code = String(json.code);
    const data = json.data ?? {};
    const providerStatus = typeof data.status === 'string' ? data.status.toUpperCase() : '';

    let status: PaymentResult['status'];
    if (code === '00' && providerStatus === 'ACCEPTED') status = 'success';
    else if (PENDING_STATUSES.has(providerStatus) || PENDING_CODES.has(code)) status = 'pending';
    else status = 'failed';

    return {
      provider: this.name,
      reference,
      status,
      amount: toNumber(data.amount),
      currency: data.currency,
      method: data.payment_method,
      operatorReference: data.operator_id ?? undefined,
      paidAt: data.payment_date || undefined,
      message: json.message,
      verifiedBy: 'status-api',
      raw: json,
    };
  }

  async parseWebhook(request: IncomingRequest): Promise<WebhookEvent> {
    const fields = readFields(request);
    const reference = fields.cpm_trans_id;
    if (!reference) throw new ValidationError('cinetpay : notification sans cpm_trans_id', { provider: this.name });
    if (fields.cpm_site_id && fields.cpm_site_id !== this.options.siteId) {
      throw new ValidationError('cinetpay : cpm_site_id inattendu', { provider: this.name });
    }

    let verified = false;
    if (this.options.secretKey) {
      const received = getHeader(request.headers, 'x-token');
      const expected = hmacSha256Hex(this.options.secretKey, HMAC_FIELDS.map((f) => fields[f] ?? '').join(''));
      verified = safeEqual(received, expected);
      if (received && !verified) {
        // Un x-token présent mais faux est une notification forgée : rejet immédiat.
        throw new WebhookVerificationError('cinetpay : x-token invalide', { provider: this.name });
      }
    }

    return {
      provider: this.name,
      reference,
      // La notification CinetPay ne porte pas de statut fiable : il est
      // toujours obtenu via getStatus() par PaymentClient.handleWebhook().
      status: 'pending',
      amount: toNumber(fields.cpm_amount),
      currency: fields.cpm_currency,
      method: fields.payment_method,
      verified,
      verifiedBy: verified ? 'signature' : undefined,
      fields,
    };
  }
}
