export declare class PaymentError extends Error {
    readonly provider?: string;
    readonly code?: string;
    readonly details?: unknown;
    constructor(message: string, options?: {
        provider?: string;
        code?: string;
        details?: unknown;
    });
}
/** Requête invalide (champ manquant, canal non supporté...). Ne pas retenter tel quel. */
export declare class ValidationError extends PaymentError {
    constructor(message: string, options?: {
        provider?: string;
        code?: string;
        details?: unknown;
    });
}
/** Agrégateur injoignable ou en erreur serveur (5xx, réseau, timeout). Peut être retenté / basculé. */
export declare class ProviderUnavailableError extends PaymentError {
    constructor(message: string, options?: {
        provider?: string;
        code?: string;
        details?: unknown;
    });
}
/** Notification impossible à authentifier : NE JAMAIS créditer le client. */
export declare class WebhookVerificationError extends PaymentError {
    constructor(message: string, options?: {
        provider?: string;
        code?: string;
        details?: unknown;
    });
}
/** Le montant payé ne correspond pas au montant attendu : NE PAS créditer. */
export declare class AmountMismatchError extends PaymentError {
    readonly expected: number;
    readonly received?: number;
    constructor(expected: number, received: number | undefined, provider?: string);
}
