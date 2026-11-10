import type { Channel } from './types.js';
/**
 * Normalise un numéro ivoirien au format national à 10 chiffres.
 * Accepte espaces, tirets, points, et les préfixes +225 / 00225 / 225.
 * Retourne null si le numéro n'est pas un numéro ivoirien valide.
 */
export declare function normalizeCiPhone(input: string): string | null;
/** Format international E.164 : +225XXXXXXXXXX. */
export declare function toE164Ci(input: string): string | null;
/** Déduit le canal Mobile Money de l'opérateur à partir d'un numéro ivoirien. */
export declare function detectCiOperator(input: string): Extract<Channel, 'ORANGE_CI' | 'MTN_CI' | 'MOOV_CI'> | null;
