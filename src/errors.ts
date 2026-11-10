// errors.ts — erreurs typées, pour que l'app distingue ce qui peut être
// retenté (agrégateur indisponible) de ce qui ne doit pas l'être.

export class PaymentError extends Error {
  readonly provider?: string;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options: { provider?: string; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'PaymentError';
    this.provider = options.provider;
    this.code = options.code;
    this.details = options.details;
  }
}

/** Requête invalide (champ manquant, canal non supporté...). Ne pas retenter tel quel. */
export class ValidationError extends PaymentError {
  constructor(message: string, options: { provider?: string; code?: string; details?: unknown } = {}) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

/** Agrégateur injoignable ou en erreur serveur (5xx, réseau, timeout). Peut être retenté / basculé. */
export class ProviderUnavailableError extends PaymentError {
  constructor(message: string, options: { provider?: string; code?: string; details?: unknown } = {}) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

/** Notification impossible à authentifier : NE JAMAIS créditer le client. */
export class WebhookVerificationError extends PaymentError {
  constructor(message: string, options: { provider?: string; code?: string; details?: unknown } = {}) {
    super(message, options);
    this.name = 'WebhookVerificationError';
  }
}

/** Le montant payé ne correspond pas au montant attendu : NE PAS créditer. */
export class AmountMismatchError extends PaymentError {
  readonly expected: number;
  readonly received?: number;

  constructor(expected: number, received: number | undefined, provider?: string) {
    super(`Montant incohérent : attendu ${expected}, reçu ${received ?? 'aucun'}`, { provider });
    this.name = 'AmountMismatchError';
    this.expected = expected;
    this.received = received;
  }
}
