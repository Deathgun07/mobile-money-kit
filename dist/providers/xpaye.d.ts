import type { Channel, IncomingRequest, PaymentProvider, PaymentRequest, PaymentSession, WebhookEvent } from '../types.js';
import { type FetchLike } from '../utils.js';
/**
 * Codes de canaux XPAYE, tels que listés par la documentation officielle :
 * https://sandbox.paiementpro.net/test-sandbox.html (relevé du 2026-11-10).
 * Le kit n'en fournit pas d'autres : tout code supplémentaire est ajouté par
 * l'intégrateur via `channelCodes`, sous sa responsabilité.
 */
export declare const XPAYE_CHANNEL_CODES: Partial<Record<Channel, string>>;
/**
 * hashcode XPAYE = SHA-256(referenceNumber|amount|merchantId|secretKey), en hex.
 * Les valeurs sont prises telles que reçues (pas de reformatage du montant).
 */
export declare function computeXpayeHashcode(fields: Record<string, unknown>, secretKey: string): string;
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
export declare class XpayeProvider implements PaymentProvider {
    readonly name = "xpaye";
    readonly supportedChannels: readonly Channel[];
    private readonly options;
    private readonly codes;
    constructor(options: XpayeOptions);
    private get initUrl();
    /** Jeton d'authentification de la notification pour une référence donnée. */
    notifyToken(reference: string): string | null;
    private resolveChannel;
    createPayment(request: PaymentRequest): Promise<PaymentSession>;
    parseWebhook(request: IncomingRequest): Promise<WebhookEvent>;
    /** true / false si le hashcode a pu être vérifié, undefined sinon (absent ou aucune clé). */
    private checkHashcode;
}
