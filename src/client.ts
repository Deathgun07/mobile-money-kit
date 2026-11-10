// client.ts — point d'entrée de l'app. Choisit l'agrégateur, bascule sur le
// suivant en cas de panne, et applique les règles de sécurité des notifications.

import {
  AmountMismatchError,
  PaymentError,
  ProviderUnavailableError,
  ValidationError,
  WebhookVerificationError,
} from './errors.js';
import { CHANNEL_ORDER, channelInfo, type ChannelInfo } from './channels.js';
import type { Channel, IncomingRequest, PaymentProvider, PaymentRequest, PaymentResult, PaymentSession } from './types.js';
import { queryParams, withQueryParam } from './utils.js';

/** Paramètre ajouté à notifyUrl pour savoir quel agrégateur envoie la notification. */
export const PROVIDER_PARAM = 'provider';

export interface PaymentClientOptions {
  /** Agrégateurs par ordre de préférence. Le premier qui supporte le canal est utilisé. */
  providers: PaymentProvider[];
  /**
   * Moyens de paiement que TON app accepte, dans l'ordre d'affichage
   * (ex: ['WAVE_CI', 'ORANGE_CI']). Tout autre canal est refusé par
   * createPayment(). Défaut : tous ceux que les agrégateurs supportent.
   * 'ALL' / 'MOBILE_MONEY' doivent figurer ici pour être acceptés.
   */
  channels?: readonly Channel[];
  /**
   * Si un agrégateur est indisponible (réseau, 5xx), essayer le suivant.
   * Défaut : true. Les erreurs de validation ne déclenchent jamais de bascule.
   */
  fallback?: boolean;
  /** Appelé à chaque bascule (pour tes logs / alertes). */
  onFallback?: (failed: string, error: PaymentError, next: string) => void;
}

export interface CreatePaymentOptions {
  /** Forcer un agrégateur précis (par son nom), sans bascule. */
  provider?: string;
}

export interface HandleWebhookOptions {
  /**
   * Montant attendu pour cette référence — à lire dans TA base, jamais dans la
   * notification. Si fourni et différent du montant payé : AmountMismatchError.
   * Fortement recommandé.
   */
  expectedAmount?: number | ((reference: string) => number | undefined | Promise<number | undefined>);
  /**
   * DANGEREUX — accepter une notification non authentifiée quand l'agrégateur
   * n'a pas d'API de statut. N'utiliser que pour un test ponctuel en sandbox.
   */
  unsafeAllowUnverified?: boolean;
}

export class PaymentClient {
  private readonly providers: PaymentProvider[];
  private readonly fallback: boolean;
  private readonly onFallback?: PaymentClientOptions['onFallback'];
  private readonly channels?: readonly Channel[];

  constructor(options: PaymentClientOptions) {
    if (!options.providers?.length) {
      throw new ValidationError('PaymentClient : au moins un agrégateur est requis');
    }
    const names = new Set<string>();
    for (const p of options.providers) {
      if (names.has(p.name)) throw new ValidationError(`Agrégateur en double : ${p.name}`);
      names.add(p.name);
    }
    this.providers = options.providers;
    this.fallback = options.fallback ?? true;
    this.onFallback = options.onFallback;
    if (options.channels) {
      const supported = new Set(options.providers.flatMap((p) => p.supportedChannels));
      const unsupported = options.channels.filter((c) => !supported.has(c));
      if (!options.channels.length || unsupported.length) {
        throw new ValidationError(
          unsupported.length
            ? `Canaux non supportés par les agrégateurs configurés : ${unsupported.join(', ')}`
            : 'PaymentClient : channels ne peut pas être vide'
        );
      }
      this.channels = [...new Set(options.channels)];
    }
  }

  /** Retourne l'adaptateur enregistré sous ce nom. */
  provider(name: string): PaymentProvider {
    const found = this.providers.find((p) => p.name === name);
    if (!found) throw new ValidationError(`Agrégateur inconnu : ${name}`);
    return found;
  }

  /**
   * Moyens de paiement réellement proposables (supportés par au moins un
   * agrégateur configuré), avec leurs libellés. Sans donnée secrète : peut être
   * renvoyé tel quel au navigateur ou à l'app mobile pour l'écran de choix.
   * Ordre et sélection : `only`, sinon l'option `channels` du client, sinon
   * l'ordre par défaut.
   */
  availableChannels(only?: readonly Channel[]): ChannelInfo[] {
    const supported = new Set(this.providers.flatMap((p) => p.supportedChannels));
    const out: ChannelInfo[] = [];
    for (const channel of only ?? this.channels ?? CHANNEL_ORDER) {
      if (this.channels && !this.channels.includes(channel)) continue;
      const info = supported.has(channel) ? channelInfo(channel) : null;
      if (info && !out.some((c) => c.channel === channel)) out.push(info);
    }
    return out;
  }

  /**
   * Crée une session de paiement et retourne l'URL où rediriger le client.
   * `session.provider` indique l'agrégateur réellement utilisé : stocke-le en
   * base avec la référence, il servira à traiter la notification.
   */
  async createPayment(request: PaymentRequest, options: CreatePaymentOptions = {}): Promise<PaymentSession> {
    validateRequest(request);
    const channel = request.channel ?? 'ALL';
    if (this.channels && !this.channels.includes(channel)) {
      throw new ValidationError(`Moyen de paiement non proposé : ${channel}`);
    }

    // Chaque agrégateur reçoit une notifyUrl portant son nom (?provider=xpaye),
    // pour que handleNotification() sache qui l'appelle, même après une bascule.
    const forProvider = (p: PaymentProvider): PaymentRequest => ({
      ...request,
      notifyUrl: withQueryParam(request.notifyUrl, PROVIDER_PARAM, p.name),
    });

    if (options.provider) {
      const p = this.provider(options.provider);
      return p.createPayment(forProvider(p));
    }

    const candidates = this.providers.filter((p) => p.supportedChannels.includes(channel));
    if (!candidates.length) {
      throw new ValidationError(`Aucun agrégateur configuré ne supporte le canal ${channel}`);
    }

    let lastError: PaymentError | undefined;
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i];
      try {
        return await provider.createPayment(forProvider(provider));
      } catch (err) {
        const next = candidates[i + 1];
        if (err instanceof ProviderUnavailableError && this.fallback && next) {
          lastError = err;
          this.onFallback?.(provider.name, err, next.name);
          continue;
        }
        throw err;
      }
    }
    throw lastError ?? new PaymentError('Aucun agrégateur disponible');
  }

  /** Statut d'un paiement, demandé directement à l'agrégateur (si son API le permet). */
  async getStatus(providerName: string, reference: string): Promise<PaymentResult> {
    const provider = this.provider(providerName);
    if (!provider.getStatus) {
      throw new ValidationError(`${provider.name} ne propose pas d'API de vérification de statut`, {
        provider: provider.name,
      });
    }
    return provider.getStatus(reference);
  }

  /**
   * Comme handleWebhook(), mais l'agrégateur est déduit du paramètre
   * `?provider=` que createPayment() a ajouté à notifyUrl. C'est la méthode à
   * utiliser dans ta route de notification.
   */
  async handleNotification(request: IncomingRequest, options: HandleWebhookOptions = {}): Promise<PaymentResult> {
    const name = queryParams(request.url).get(PROVIDER_PARAM);
    if (!name) {
      throw new WebhookVerificationError(`Notification sans paramètre ?${PROVIDER_PARAM}= : URL inattendue`);
    }
    return this.handleWebhook(name, request, options);
  }

  /**
   * Traite une notification (webhook) de façon sûre :
   *   1. lecture + authentification de la notification (signature ou jeton) ;
   *   2. si l'agrégateur a une API de statut, le statut est TOUJOURS reconfirmé
   *      auprès de lui (serveur-à-serveur) — la notification seule ne suffit pas ;
   *   3. sinon, une notification non authentifiée est rejetée ;
   *   4. vérification du montant attendu.
   *
   * Il reste à TON app : vérifier que la référence existe en base et n'a pas
   * déjà été traitée (idempotence), puis créditer le client.
   */
  async handleWebhook(
    providerName: string,
    request: IncomingRequest,
    options: HandleWebhookOptions = {}
  ): Promise<PaymentResult> {
    const provider = this.provider(providerName);
    const event = await provider.parseWebhook(request);

    let result: PaymentResult;
    if (provider.getStatus) {
      result = await provider.getStatus(event.reference);
    } else if (event.verified || options.unsafeAllowUnverified) {
      result = {
        provider: provider.name,
        reference: event.reference,
        status: event.status,
        amount: event.amount,
        currency: event.currency,
        method: event.method,
        operatorReference: event.operatorReference,
        verifiedBy: event.verified ? event.verifiedBy! : 'unverified',
        raw: event.fields,
      };
    } else {
      throw new WebhookVerificationError(
        `${provider.name} : notification non authentifiée pour ${event.reference} (jeton ou signature absents/invalides)`,
        { provider: provider.name }
      );
    }

    if (result.reference !== event.reference) {
      throw new WebhookVerificationError('Référence incohérente entre la notification et le statut', {
        provider: provider.name,
      });
    }

    if (options.expectedAmount !== undefined && result.status === 'success') {
      const expected =
        typeof options.expectedAmount === 'function'
          ? await options.expectedAmount(result.reference)
          : options.expectedAmount;
      if (expected === undefined) {
        throw new WebhookVerificationError(`Référence inconnue : ${result.reference}`, { provider: provider.name });
      }
      if (result.amount !== expected) {
        throw new AmountMismatchError(expected, result.amount, provider.name);
      }
    }

    return result;
  }
}

function validateRequest(request: PaymentRequest): void {
  if (!request.reference?.trim()) throw new ValidationError('reference est obligatoire');
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(request.reference)) {
    throw new ValidationError('reference : 1 à 100 caractères parmi lettres, chiffres, _ . : -');
  }
  if (!Number.isInteger(request.amount) || request.amount <= 0) {
    throw new ValidationError('amount doit être un entier strictement positif');
  }
  if (!request.description?.trim()) throw new ValidationError('description est obligatoire');
  if (!request.customer?.firstName || !request.customer?.lastName) {
    throw new ValidationError('customer.firstName et customer.lastName sont obligatoires');
  }
  for (const key of ['returnUrl', 'notifyUrl'] as const) {
    let url: URL;
    try {
      url = new URL(request[key]);
    } catch {
      throw new ValidationError(`${key} doit être une URL absolue`);
    }
    if (key === 'notifyUrl' && url.protocol !== 'https:' && !isLocal(url)) {
      throw new ValidationError('notifyUrl doit être en https');
    }
  }
}

function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}
