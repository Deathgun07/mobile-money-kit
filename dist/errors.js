// errors.ts — erreurs typées, pour que l'app distingue ce qui peut être
// retenté (agrégateur indisponible) de ce qui ne doit pas l'être.
export class PaymentError extends Error {
    provider;
    code;
    details;
    constructor(message, options = {}) {
        super(message);
        this.name = 'PaymentError';
        this.provider = options.provider;
        this.code = options.code;
        this.details = options.details;
    }
}
/** Requête invalide (champ manquant, canal non supporté...). Ne pas retenter tel quel. */
export class ValidationError extends PaymentError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'ValidationError';
    }
}
/** Agrégateur injoignable ou en erreur serveur (5xx, réseau, timeout). Peut être retenté / basculé. */
export class ProviderUnavailableError extends PaymentError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'ProviderUnavailableError';
    }
}
/** Notification impossible à authentifier : NE JAMAIS créditer le client. */
export class WebhookVerificationError extends PaymentError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'WebhookVerificationError';
    }
}
/** Le montant payé ne correspond pas au montant attendu : NE PAS créditer. */
export class AmountMismatchError extends PaymentError {
    expected;
    received;
    constructor(expected, received, provider) {
        super(`Montant incohérent : attendu ${expected}, reçu ${received ?? 'aucun'}`, { provider });
        this.name = 'AmountMismatchError';
        this.expected = expected;
        this.received = received;
    }
}
