import { PaymentError } from './errors.js';
import { type ChannelInfo } from './channels.js';
import type { Channel, IncomingRequest, PaymentProvider, PaymentRequest, PaymentResult, PaymentSession } from './types.js';
/** Paramètre ajouté à notifyUrl pour savoir quel agrégateur envoie la notification. */
export declare const PROVIDER_PARAM = "provider";
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
export declare class PaymentClient {
    private readonly providers;
    private readonly fallback;
    private readonly onFallback?;
    private readonly channels?;
    constructor(options: PaymentClientOptions);
    /** Retourne l'adaptateur enregistré sous ce nom. */
    provider(name: string): PaymentProvider;
    /**
     * Moyens de paiement réellement proposables (supportés par au moins un
     * agrégateur configuré), avec leurs libellés. Sans donnée secrète : peut être
     * renvoyé tel quel au navigateur ou à l'app mobile pour l'écran de choix.
     * Ordre et sélection : `only`, sinon l'option `channels` du client, sinon
     * l'ordre par défaut.
     */
    availableChannels(only?: readonly Channel[]): ChannelInfo[];
    /**
     * Crée une session de paiement et retourne l'URL où rediriger le client.
     * `session.provider` indique l'agrégateur réellement utilisé : stocke-le en
     * base avec la référence, il servira à traiter la notification.
     */
    createPayment(request: PaymentRequest, options?: CreatePaymentOptions): Promise<PaymentSession>;
    /** Statut d'un paiement, demandé directement à l'agrégateur (si son API le permet). */
    getStatus(providerName: string, reference: string): Promise<PaymentResult>;
    /**
     * Comme handleWebhook(), mais l'agrégateur est déduit du paramètre
     * `?provider=` que createPayment() a ajouté à notifyUrl. C'est la méthode à
     * utiliser dans ta route de notification.
     */
    handleNotification(request: IncomingRequest, options?: HandleWebhookOptions): Promise<PaymentResult>;
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
    handleWebhook(providerName: string, request: IncomingRequest, options?: HandleWebhookOptions): Promise<PaymentResult>;
}
