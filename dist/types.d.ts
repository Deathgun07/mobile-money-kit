export type Currency = 'XOF' | 'XAF' | 'GNF' | 'CDF' | 'USD';
/**
 * Canaux de paiement universels. Chaque adaptateur les traduit vers les codes
 * propres à son agrégateur (ex: ORANGE_CI → "OMCIV2" chez Xpaye).
 *
 * - ALL / MOBILE_MONEY : le client choisit l'opérateur sur la page de paiement
 *   (si l'agrégateur le permet ; sinon l'adaptateur tente de déduire
 *   l'opérateur depuis le numéro de téléphone).
 */
export type Channel = 'ALL' | 'MOBILE_MONEY' | 'CARD' | 'ORANGE_CI' | 'MTN_CI' | 'MOOV_CI' | 'WAVE_CI' | 'ORANGE_SN' | 'WAVE_SN' | 'ORANGE_BF' | 'ORANGE_ML' | 'MTN_BJ' | 'MOOV_BJ' | 'MOOV_TG' | 'TOGOCEL_TG' | 'AIRTEL_NE' | 'ORANGE_GW' | 'ORANGE_CM' | 'MTN_CM' | 'PAYPAL';
export type PaymentStatus = 'pending' | 'success' | 'failed';
export interface Customer {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    /** Code pays ISO à 2 lettres (ex: 'CI'). */
    country?: string;
    /** Identifiant du client dans ton système. */
    id?: string;
}
export interface PaymentRequest {
    /** Référence unique générée par ton app (stockée en base AVANT l'appel). */
    reference: string;
    /** Montant entier, dans la devise (FCFA : pas de centimes). */
    amount: number;
    /** Défaut : 'XOF'. */
    currency?: Currency;
    description: string;
    /** Défaut : 'ALL'. */
    channel?: Channel;
    customer: Customer;
    /** URL où le client est redirigé après le paiement (NE PROUVE RIEN : falsifiable). */
    returnUrl: string;
    /** URL appelée serveur-à-serveur par l'agrégateur : la seule source de vérité. */
    notifyUrl: string;
    /** Donnée libre renvoyée par l'agrégateur (ex: JSON.stringify({ orderId })). */
    metadata?: string;
}
export interface PaymentSession {
    provider: string;
    reference: string;
    /** URL de la page de paiement où rediriger le client. */
    paymentUrl: string;
    /** Jeton propre à l'agrégateur, si fourni. */
    providerToken?: string;
    raw: unknown;
}
export interface PaymentResult {
    provider: string;
    reference: string;
    status: PaymentStatus;
    amount?: number;
    currency?: string;
    /** Moyen de paiement utilisé, tel que renvoyé par l'agrégateur (ex: 'OM', 'WAVECI'). */
    method?: string;
    /** Référence de la transaction chez l'opérateur, si fournie. */
    operatorReference?: string;
    paidAt?: string;
    message?: string;
    /** Comment ce résultat a été authentifié. */
    verifiedBy: 'status-api' | 'signature' | 'notify-token' | 'unverified';
    raw: unknown;
}
/**
 * Requête HTTP entrante (notification de l'agrégateur), sous une forme
 * indépendante du framework (Next.js, Express, Fastify, Hono...).
 */
export interface IncomingRequest {
    /** URL complète ou chemin + query string (nécessaire pour le jeton de notification). */
    url?: string;
    headers?: Headers | Record<string, string | string[] | undefined>;
    /** Corps brut (string), déjà décodé (objet), ou URLSearchParams. */
    body?: string | URLSearchParams | Record<string, unknown> | null;
}
export interface WebhookEvent {
    provider: string;
    reference: string;
    /** Statut annoncé par la notification (à confirmer si possible via l'API de statut). */
    status: PaymentStatus;
    amount?: number;
    currency?: string;
    method?: string;
    /** Référence de la transaction chez l'agrégateur / l'opérateur, si fournie. */
    operatorReference?: string;
    /** Notification authentifiée (signature ou jeton valide). */
    verified: boolean;
    verifiedBy?: 'signature' | 'notify-token';
    /** Champs bruts reçus. */
    fields: Record<string, string>;
}
export interface PaymentProvider {
    readonly name: string;
    readonly supportedChannels: readonly Channel[];
    createPayment(request: PaymentRequest): Promise<PaymentSession>;
    /** Interroge l'agrégateur (serveur-à-serveur). Absent si l'agrégateur n'a pas d'API de statut publique. */
    getStatus?(reference: string): Promise<PaymentResult>;
    parseWebhook(request: IncomingRequest): Promise<WebhookEvent>;
}
