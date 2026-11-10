// phone.ts — numéros ivoiriens (plan à 10 chiffres en vigueur depuis 2021).
// Préfixes mobiles : 01 = Moov Africa, 05 = MTN, 07 = Orange.
// Wave n'est pas un opérateur téléphonique : il ne se déduit pas du numéro.
/**
 * Normalise un numéro ivoirien au format national à 10 chiffres.
 * Accepte espaces, tirets, points, et les préfixes +225 / 00225 / 225.
 * Retourne null si le numéro n'est pas un numéro ivoirien valide.
 */
export function normalizeCiPhone(input) {
    let digits = input.replace(/[\s.\-()]/g, '');
    if (digits.startsWith('+'))
        digits = digits.slice(1);
    if (digits.startsWith('00225'))
        digits = digits.slice(5);
    else if (digits.startsWith('225') && digits.length === 13)
        digits = digits.slice(3);
    return /^\d{10}$/.test(digits) ? digits : null;
}
/** Format international E.164 : +225XXXXXXXXXX. */
export function toE164Ci(input) {
    const national = normalizeCiPhone(input);
    return national ? `+225${national}` : null;
}
/** Déduit le canal Mobile Money de l'opérateur à partir d'un numéro ivoirien. */
export function detectCiOperator(input) {
    const national = normalizeCiPhone(input);
    if (!national)
        return null;
    switch (national.slice(0, 2)) {
        case '07':
            return 'ORANGE_CI';
        case '05':
            return 'MTN_CI';
        case '01':
            return 'MOOV_CI';
        default:
            return null;
    }
}
