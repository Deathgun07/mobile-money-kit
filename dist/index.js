// mobile-money-kit — SDK Mobile Money unifié pour l'Afrique de l'Ouest.
// À utiliser UNIQUEMENT côté serveur (Node, Next.js route handlers, Express...) :
// les clés des agrégateurs ne doivent jamais être envoyées au navigateur ou à l'app mobile.
export { PaymentClient, PROVIDER_PARAM } from './client.js';
export { XpayeProvider, XPAYE_CHANNEL_CODES, computeXpayeHashcode } from './providers/xpaye.js';
export { CinetPayProvider } from './providers/cinetpay.js';
export { CHANNEL_INFO, CHANNEL_ORDER, channelInfo } from './channels.js';
export { normalizeCiPhone, toE164Ci, detectCiOperator } from './phone.js';
export { redactFields } from './utils.js';
export { PaymentError, ValidationError, ProviderUnavailableError, WebhookVerificationError, AmountMismatchError, } from './errors.js';
