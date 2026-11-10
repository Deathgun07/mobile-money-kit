# mobile-money-kit

SDK **XPAYE (ex-Paiement Pro)** pour encaisser en ligne par Mobile Money,
carte bancaire et PayPal en Afrique de l'Ouest et centrale : **Orange Money,
MTN MoMo, Moov Money / Flooz, Wave, Togocel, Airtel Money**… avec une API
simple et des notifications sécurisées par défaut.

> ✅ **Éprouvé avec XPAYE en production** (Orange Money, MTN MoMo, Wave et
> carte en Côte d'Ivoire). CinetPay est aussi fourni, comme agrégateur de
> secours facultatif.

- **XPAYE prêt à l'emploi** : initialisation, page de paiement, et lecture
  de sa notification réelle (paramètres dans l'URL, second `?` réparé).
- **Notifications vérifiées par défaut** : jeton secret propre à chaque
  paiement + `hashcode` XPAYE (formule confirmée sur un vrai paiement). Une
  notification non authentifiée est rejetée.
- **Contrôle du montant** payé contre le montant attendu.
- **Tu choisis tes moyens de paiement** parmi les 18 canaux officiels XPAYE.
- **Numéros ivoiriens** : normalisation et détection de l'opérateur (01 Moov,
  05 MTN, 07 Orange).
- **Bascule automatique** vers un second agrégateur (CinetPay) si XPAYE est
  indisponible, si tu le souhaites.
- Aucune dépendance. TypeScript. Node 18+ ou Bun (Next.js, Express, Fastify,
  Hono, Elysia…).

> 🔑 **Aucune clé n'est fournie.** Ouvre ton propre compte marchand XPAYE et
> passe tes identifiants par variables d'environnement. Ne commite jamais de
> clé.

> ⚠️ **Côté serveur uniquement.** Les clés ne doivent jamais se retrouver
> dans le navigateur ou dans l'app mobile. L'app appelle TON serveur, qui
> appelle XPAYE.

## Installation

Le kit n'est pas encore sur npm : installe-le depuis GitHub, avec ton
gestionnaire de paquets habituel. Le code compilé est inclus, aucun script
d'installation n'est exécuté.

```bash
# Bun
bun add github:Deathgun07/mobile-money-kit#v0.3.1

# npm
npm install github:Deathgun07/mobile-money-kit#v0.3.1

# pnpm
pnpm add github:Deathgun07/mobile-money-kit#v0.3.1

# Yarn
yarn add mobile-money-kit@github:Deathgun07/mobile-money-kit#v0.3.1
```

Garde le `#v0.3.1` : sans lui, tu installes l'état courant de la branche
`main`, qui peut changer.

## Configuration

Variables d'environnement (fichier `.env`, jamais commité) :

```bash
XPAYE_MERCHANT_ID=PP-XXXX          # identifiant marchand fourni par XPAYE
XPAYE_SECRET_KEY=...               # clé secrète marchand fournie par XPAYE
XPAYE_WEBHOOK_SECRET=...           # secret généré PAR TOI, 32+ caractères :
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```ts
// lib/payments.ts
import { PaymentClient, XpayeProvider } from 'mobile-money-kit';

export const payments = new PaymentClient({
  providers: [
    new XpayeProvider({
      merchantId: process.env.XPAYE_MERCHANT_ID!,
      // Signe le jeton ajouté à l'URL de notification : seul XPAYE la connaît.
      webhookSecret: process.env.XPAYE_WEBHOOK_SECRET!,
      // Active la vérification du hashcode envoyé par XPAYE.
      secretKey: process.env.XPAYE_SECRET_KEY,
      sandbox: process.env.NODE_ENV !== 'production',
    }),
  ],
  // Les moyens que TU proposes, dans l'ordre d'affichage (voir « Moyens de paiement »)
  channels: ['WAVE_CI', 'ORANGE_CI', 'MTN_CI', 'CARD'],
});
```

### Facultatif : CinetPay en secours

Si XPAYE est injoignable, le paiement peut basculer automatiquement vers
CinetPay (compte CinetPay requis) :

```ts
import { CinetPayProvider } from 'mobile-money-kit';

new PaymentClient({
  providers: [
    new XpayeProvider({ /* … */ }),            // toujours essayé en premier
    new CinetPayProvider({
      apiKey: process.env.CINETPAY_API_KEY!,
      siteId: process.env.CINETPAY_SITE_ID!,
      secretKey: process.env.CINETPAY_SECRET_KEY,
    }),
  ],
  onFallback: (from, error, to) => console.warn(`[paiement] ${from} indisponible, bascule vers ${to}`, error.message),
});
```

## 1. Créer un paiement

```ts
// app/api/paiement/init/route.ts (Next.js)
import { payments } from '@/lib/payments';

export async function POST(req: Request) {
  const user = await getUser(req);                 // ton authentification
  const reference = `CMD-${crypto.randomUUID()}`;
  const amount = 2000;                             // fixé par le SERVEUR, jamais par le client

  // 1. Enregistrer le paiement en attente AVANT d'appeler l'agrégateur
  await db.payments.create({ reference, userId: user.id, amount, status: 'pending' });

  // 2. Créer la session
  const session = await payments.createPayment({
    reference,
    amount,
    description: 'Abonnement Premium 1 mois',
    channel: 'WAVE_CI',             // ou 'ORANGE_CI', 'MTN_CI', 'MOOV_CI', 'CARD', 'MOBILE_MONEY', 'ALL'
    customer: { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone },
    returnUrl: 'https://monapp.ci/abonnement?retour=1',
    notifyUrl: 'https://monapp.ci/api/paiement/notify',
  });

  // 3. (Facultatif) Retenir quel agrégateur a été utilisé, pour tes statistiques
  await db.payments.update(reference, { provider: session.provider });

  return Response.json({ url: session.paymentUrl });
}
```

## 2. Recevoir la notification (la seule source de vérité)

```ts
// app/api/paiement/notify/route.ts (Next.js)
import { payments, WebhookVerificationError, AmountMismatchError } from 'mobile-money-kit';

export async function POST(req: Request) {
  try {
    // Pour tes logs : redactFields(...) masque signatures, jetons et e-mails.
    // L'agrégateur est reconnu grâce au paramètre ?provider= que createPayment()
    // a ajouté à notifyUrl (fonctionne aussi après une bascule).
    const result = await payments.handleNotification(
      { url: req.url, headers: req.headers, body: await req.text() },
      // Montant attendu, lu dans TA base pour la référence authentifiée
      { expectedAmount: async (reference) => (await db.payments.findByReference(reference))?.amount }
    );

    // Statut encore inconnu (code XPAYE inattendu, CinetPay en attente) : rien à faire.
    if (result.status === 'pending') return Response.json({ ok: true, pending: true });

    // Idempotence : une notification peut arriver plusieurs fois
    const payment = await db.payments.findByReference(result.reference);
    if (payment.status !== 'pending') return Response.json({ ok: true });

    await db.payments.update(result.reference, { status: result.status, raw: result.raw });
    if (result.status === 'success') await grantPremium(payment.userId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof WebhookVerificationError || err instanceof AmountMismatchError) {
      console.error('[paiement] notification rejetée :', err.message);
      return new Response('rejeté', { status: 400 });
    }
    throw err;
  }
}
```

Si tu préfères une route par agrégateur, utilise
`payments.handleWebhook('xpaye', request, options)`.

### Ce que fait `handleNotification` / `handleWebhook`

| Agrégateur | Authentification | Statut final |
|---|---|---|
| **XPAYE** | Jeton secret ajouté à `notificationURL` (`?nt=…`) ; `hashcode` vérifié si `secretKey`, un hashcode faux est rejeté | Lu dans la notification **uniquement si authentifiée** |
| **CinetPay** | x-token HMAC-SHA256 (si `secretKey`) ; un x-token faux est rejeté | **Toujours reconfirmé** via l'API `/payment/check` |

Puis, si `expectedAmount` est fourni, le montant payé doit être exactement
celui attendu.

### Il reste à ton application

1. Vérifier que la référence existe et est encore `pending` (idempotence : une
   notification peut arriver plusieurs fois).
2. Créditer le client.
3. **Ne jamais créditer depuis `returnUrl`** : c'est le navigateur du client
   qui y arrive, avec des paramètres qu'il peut modifier. Sur cette page,
   affiche « paiement en cours de confirmation » et attends la notification.

### La page de retour (`returnUrl`)

Elle est en **lecture seule** : elle lit le statut dans TA base, jamais dans
ses propres paramètres.

```ts
// app/api/paiement/retour/route.ts (Next.js) — returnUrl pointe ici
export async function GET(req: Request) {
  const reference = new URL(req.url).searchParams.get('ref');  // ajoutée par toi dans returnUrl
  // La notification arrive souvent juste avant le client : on l'attend un peu.
  let payment;
  for (let i = 0; i < 5; i++) {
    payment = reference ? await db.payments.findByReference(reference) : null;
    if (!payment || payment.status !== 'pending') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const etat = payment?.status === 'success' ? '1' : payment?.status === 'pending' ? 'pending' : '0';
  return Response.redirect(`https://monapp.ci/abonnement?success=${etat}`);
}
```

Pour une app mobile, `returnUrl` peut être un lien profond
(`monapp://abonnement`). N'accepte que le scheme de ton app si le client te
le transmet : sinon l'agrégateur redirigerait vers une URL arbitraire.

## XPAYE : à savoir

- XPAYE n'a **pas d'API publique de vérification de statut**. La notification
  est donc la seule source, d'où l'importance du `webhookSecret`.
- La notification arrive **dans l'URL, corps vide**, et XPAYE colle ses
  paramètres avec un second `?` (`…&nt=<jeton>?merchantId=…&amount=…`). Le kit
  répare ce format : passe-lui simplement `req.url`.
- Formule du `hashcode` (confirmée sur un vrai paiement) :
  `SHA-256(referenceNumber|amount|merchantId|clé secrète)` en hexadécimal,
  disponible via `computeXpayeHashcode(fields, secretKey)`.
  ⚠️ **Le statut n'est pas signé** : un paiement échoué et un paiement réussi
  de même référence et même montant ont le même hashcode. C'est pourquoi :
  - un hashcode **faux** fait toujours rejeter la notification ;
  - dès que `webhookSecret` est fourni, le **jeton `nt` est exigé**
    (`requireNotifyToken`, défaut `true`), un hashcode valide seul ne suffit pas.
- La clé secrète XPAYE est courte : ne la réutilise **pas** comme
  `webhookSecret` (32+ caractères aléatoires générés par toi).
- **Sandbox** : XPAYE n'y envoie pas toujours la notification. Pour un test
  ponctuel, `unsafeAllowUnverified: true` — jamais en production.
- **Test recommandé avant la mise en production** : fais un vrai petit
  paiement et vérifie dans tes logs que `result.verifiedBy === 'notify-token'`.
- Si XPAYE change de formule, `verifyHashcode: (fields) => boolean` remplace la
  vérification intégrée.
- `responsecode` : `0` = réussi, `-1` = échoué ; toute autre valeur donne
  `status: 'pending'` (ni crédité, ni marqué échoué).
- Le montant est lu même avec un séparateur de milliers (`2 000`), et
  `transactionId` / `transactiondt` est remonté dans `result.operatorReference`.
- La description est tronquée à 100 caractères.

### Migrer une intégration XPAYE existante

Si ton app signait déjà le jeton de notification avec
`HMAC(secret, "notify:" + référence)`, garde le même
secret et le même préfixe : les paiements ouverts avant la migration restent
reconnus.

```ts
new XpayeProvider({
  merchantId: process.env.PAIEMENTPRO_MERCHANT_ID!,
  webhookSecret: process.env.PAIEMENTPRO_NOTIFY_SECRET!,
  secretKey: process.env.PAIEMENTPRO_SECRET_KEY,
  notifyTokenPrefix: 'notify:',
});
```

La référence est aussi retrouvée dans un `returnContext` de la forme
`{ "reference": … }` ou `{ "reference_number": … }`.

## Moyens de paiement

Le kit ne fournit **que des moyens listés par la documentation officielle**
des agrégateurs, et **c'est toi qui choisis** ceux que ton app propose.

| Canal | Pays | Devise | XPAYE | CinetPay |
|---|---|---|---|---|
| `ORANGE_CI` | Côte d'Ivoire | XOF | `OMCIV2` | page CinetPay (Mobile Money) |
| `MTN_CI` | Côte d'Ivoire | XOF | `MOMOCI` | page CinetPay (Mobile Money) |
| `MOOV_CI` | Côte d'Ivoire | XOF | `FLOOZ` | page CinetPay (Mobile Money) |
| `WAVE_CI` | Côte d'Ivoire | XOF | `WAVECI` | page CinetPay (tous moyens) |
| `ORANGE_SN` | Sénégal | XOF | `OMSN` | — |
| `WAVE_SN` | Sénégal | XOF | `WAVESN` | — |
| `ORANGE_BF` | Burkina Faso | XOF | `OMBF` | — |
| `ORANGE_ML` | Mali | XOF | `OMML` | — |
| `MTN_BJ` | Bénin | XOF | `MOMOBJ` | — |
| `MOOV_BJ` | Bénin | XOF | `FLOOZBJ` | — |
| `MOOV_TG` | Togo (Flooz) | XOF | `MOOTG` | — |
| `TOGOCEL_TG` | Togo | XOF | `TOGOCEL` | — |
| `AIRTEL_NE` | Niger | XOF | `AIRTELNG` | — |
| `ORANGE_GW` | Guinée-Bissau | XOF | `OMGN` | — |
| `ORANGE_CM` | Cameroun | **XAF** | `OMCM` | — |
| `MTN_CM` | Cameroun | **XAF** | `MOMOCM` | — |
| `CARD` | Monde (Visa / Mastercard) | toutes | `CARD` | `CREDIT_CARD` |
| `PAYPAL` | Monde | toutes | `PAYPAL` | — |
| `MOBILE_MONEY` / `ALL` | | | opérateur déduit du numéro ivoirien | choix du client sur la page |

Source XPAYE : la liste officielle de
[sandbox.paiementpro.net/test-sandbox.html](https://sandbox.paiementpro.net/test-sandbox.html)
(relevée le 10/11/2026). Seuls `OMCIV2`, `MOMOCI`, `WAVECI` et `CARD` ont
déjà été utilisés en production avec ce kit ; teste les autres en sandbox
avant de les proposer.

- Un canal à devise locale refuse une autre devise (ex : `MTN_CM` exige
  `currency: 'XAF'`).
- `ORANGE_GW` : le libellé officiel est « Orange Guinée-Bissau », mais le code
  `OMGN` évoque la Guinée (Conakry) ; fais-le confirmer par XPAYE.
- Côté CinetPay, l'opérateur se choisit sur sa page ; le kit ne déclare chez
  lui que les canaux ivoiriens, la carte et `ALL` / `MOBILE_MONEY`.

### Choisir les moyens proposés

```ts
export const payments = new PaymentClient({
  providers: [/* … */],
  // Seuls ces moyens sont acceptés, dans cet ordre d'affichage.
  channels: ['WAVE_CI', 'ORANGE_CI', 'MTN_CI', 'CARD'],
});
```

- `createPayment()` refuse tout canal absent de `channels` (sans appeler
  l'agrégateur) : le client ne peut pas imposer un autre moyen.
- Sans `channels`, tous les moyens supportés par les agrégateurs configurés
  sont acceptés.
- Un canal qu'aucun agrégateur configuré ne supporte fait échouer la
  construction du client, pour éviter les surprises en production.

### Écran de choix

`availableChannels()` renvoie les moyens proposés, avec libellé et indication.
Ces données ne contiennent aucun secret : renvoie-les telles quelles à ton
front ou à ton app mobile.

```ts
// app/api/paiement/moyens/route.ts
export async function GET() {
  return Response.json(payments.availableChannels());
  // [{ channel: 'WAVE_CI', label: 'Wave', kind: 'mobile', country: 'CI', hint: "Validation dans l'application Wave" }, …]
}
```

### Codes XPAYE personnalisés

Si XPAYE change un code ou t'en confirme un nouveau, surcharge-le toi-même,
sous ta responsabilité :

```ts
new XpayeProvider({
  merchantId,
  webhookSecret,
  channelCodes: {
    ORANGE_CI: 'NOUVEAU_CODE', // si XPAYE change un code
    PAYPAL: null,              // retirer un moyen
  },
});
```

## Numéros ivoiriens

```ts
import { normalizeCiPhone, toE164Ci, detectCiOperator } from 'mobile-money-kit';

normalizeCiPhone('+225 07 07 07 07 07'); // '0707070707'
toE164Ci('05 05 05 05 05');              // '+2250505050505'
detectCiOperator('0101010101');          // 'MOOV_CI'
```

## Erreurs

| Erreur | Signification | Que faire |
|---|---|---|
| `ValidationError` | Requête invalide (champ manquant, canal non supporté…) | Corriger la requête |
| `ProviderUnavailableError` | Agrégateur injoignable / 5xx | Réessayer plus tard (la bascule est automatique s'il y a un autre agrégateur) |
| `PaymentError` | Refus de l'agrégateur (ex : référence déjà utilisée) | Voir `error.code` et `error.details` |
| `WebhookVerificationError` | Notification non authentifiée | **Ne pas créditer** |
| `AmountMismatchError` | Montant payé ≠ montant attendu | **Ne pas créditer** |

## Ajouter un agrégateur

Implémente l'interface `PaymentProvider` (`createPayment`, `parseWebhook`, et
`getStatus` si l'agrégateur le permet), puis ajoute-le dans `providers`.

## Contribuer

Les issues et pull requests sont les bienvenues. Pour un nouveau moyen de
paiement ou un nouvel agrégateur, indique la **source officielle** (page de
documentation de l'agrégateur) : le kit n'intègre aucun code non documenté.

```bash
npm install
npm test        # compile puis lance les tests (faux serveurs locaux, aucun appel réel)
npm run test:bun  # mêmes tests sous Bun

# Avant chaque commit : `npm test` recompile dist/, qui est versionné
# (il permet l'installation depuis GitHub sans script, y compris avec Bun).
```

Ne mets jamais de vraie clé ou de vrai identifiant marchand dans une issue,
un test ou une pull request.

## Sécurité

Une faille (notification forgeable, contournement du contrôle de montant…) ne
se signale **pas** dans une issue publique : voir [SECURITY.md](SECURITY.md).

## Avertissement

Projet indépendant, **non affilié** à XPAYE / Paiement Pro, CinetPay ni aux
opérateurs cités, et non approuvé par eux. Les noms sont utilisés uniquement
pour décrire la compatibilité. Fourni sans garantie (voir la licence) : teste
chaque moyen de paiement en sandbox puis avec un petit montant réel avant la
mise en production.

## Licence

MIT
