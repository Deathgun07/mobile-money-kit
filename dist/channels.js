// channels.ts — libellés des moyens de paiement, pour construire l'écran de
// choix côté app (sans exposer de clé : ces données peuvent être envoyées au
// navigateur ou à l'app mobile).
export const CHANNEL_INFO = {
    ORANGE_CI: { label: 'Orange Money', kind: 'mobile', country: 'CI', currency: 'XOF', hint: 'Validation sur votre téléphone Orange' },
    MTN_CI: { label: 'MTN MoMo', kind: 'mobile', country: 'CI', currency: 'XOF', hint: 'Validation sur votre téléphone MTN' },
    MOOV_CI: { label: 'Moov Money', kind: 'mobile', country: 'CI', currency: 'XOF', hint: 'Validation sur votre téléphone Moov' },
    WAVE_CI: { label: 'Wave', kind: 'mobile', country: 'CI', currency: 'XOF', hint: "Validation dans l'application Wave" },
    ORANGE_SN: { label: 'Orange Money Sénégal', kind: 'mobile', country: 'SN', currency: 'XOF', hint: 'Validation sur votre téléphone Orange' },
    WAVE_SN: { label: 'Wave Sénégal', kind: 'mobile', country: 'SN', currency: 'XOF', hint: "Validation dans l'application Wave" },
    ORANGE_BF: { label: 'Orange Money Burkina Faso', kind: 'mobile', country: 'BF', currency: 'XOF', hint: 'Validation sur votre téléphone Orange' },
    ORANGE_ML: { label: 'Orange Money Mali', kind: 'mobile', country: 'ML', currency: 'XOF', hint: 'Validation sur votre téléphone Orange' },
    MTN_BJ: { label: 'MTN MoMo Bénin', kind: 'mobile', country: 'BJ', currency: 'XOF', hint: 'Validation sur votre téléphone MTN' },
    MOOV_BJ: { label: 'Moov Money Bénin', kind: 'mobile', country: 'BJ', currency: 'XOF', hint: 'Validation sur votre téléphone Moov' },
    MOOV_TG: { label: 'Flooz Togo', kind: 'mobile', country: 'TG', currency: 'XOF', hint: 'Validation sur votre téléphone Moov' },
    TOGOCEL_TG: { label: 'Togocel', kind: 'mobile', country: 'TG', currency: 'XOF', hint: 'Validation sur votre téléphone Togocel' },
    AIRTEL_NE: { label: 'Airtel Money Niger', kind: 'mobile', country: 'NE', currency: 'XOF', hint: 'Validation sur votre téléphone Airtel' },
    ORANGE_GW: { label: 'Orange Money Guinée-Bissau', kind: 'mobile', country: 'GW', currency: 'XOF', hint: 'Validation sur votre téléphone Orange' },
    ORANGE_CM: { label: 'Orange Money Cameroun', kind: 'mobile', country: 'CM', currency: 'XAF', hint: 'Validation sur votre téléphone Orange' },
    MTN_CM: { label: 'MTN MoMo Cameroun', kind: 'mobile', country: 'CM', currency: 'XAF', hint: 'Validation sur votre téléphone MTN' },
    CARD: { label: 'Carte bancaire ou prépayée', kind: 'card', hint: 'Visa ou Mastercard, y compris les cartes prépayées' },
    PAYPAL: { label: 'PayPal', kind: 'wallet', hint: 'Connexion à votre compte PayPal' },
};
/** Ordre d'affichage par défaut. */
export const CHANNEL_ORDER = [
    'ORANGE_CI', 'MTN_CI', 'WAVE_CI', 'MOOV_CI',
    'ORANGE_SN', 'WAVE_SN', 'ORANGE_BF', 'ORANGE_ML', 'MTN_BJ', 'MOOV_BJ', 'MOOV_TG', 'TOGOCEL_TG', 'AIRTEL_NE', 'ORANGE_GW',
    'ORANGE_CM', 'MTN_CM',
    'CARD', 'PAYPAL',
];
export function channelInfo(channel) {
    const info = CHANNEL_INFO[channel];
    return info ? { channel, ...info } : null;
}
