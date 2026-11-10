import type { Channel, IncomingRequest, PaymentProvider, PaymentRequest, PaymentResult, PaymentSession, WebhookEvent } from '../types.js';
import { type FetchLike } from '../utils.js';
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
export declare class CinetPayProvider implements PaymentProvider {
    readonly name = "cinetpay";
    readonly supportedChannels: readonly Channel[];
    private readonly options;
    constructor(options: CinetPayOptions);
    private url;
    private post;
    createPayment(request: PaymentRequest): Promise<PaymentSession>;
    getStatus(reference: string): Promise<PaymentResult>;
    parseWebhook(request: IncomingRequest): Promise<WebhookEvent>;
}
