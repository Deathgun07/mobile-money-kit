import type { Channel, Currency } from './types.js';
export interface ChannelInfo {
    channel: Channel;
    label: string;
    kind: 'mobile' | 'card' | 'wallet';
    /** Pays ISO à 2 lettres, absent pour les moyens internationaux. */
    country?: string;
    /** Devise imposée par le moyen (opérateur local), absente sinon. */
    currency?: Currency;
    hint: string;
}
export declare const CHANNEL_INFO: Readonly<Record<Exclude<Channel, 'ALL' | 'MOBILE_MONEY'>, Omit<ChannelInfo, 'channel'>>>;
/** Ordre d'affichage par défaut. */
export declare const CHANNEL_ORDER: readonly Channel[];
export declare function channelInfo(channel: Channel): ChannelInfo | null;
