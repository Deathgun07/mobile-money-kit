# Changelog

## 0.3.1

- **Correctif** : l'installation depuis GitHub échouait avec Bun (et pnpm 10),
  qui bloquent les scripts d'installation : `dist/` n'était pas compilé. Le
  code compilé est maintenant versionné ; plus aucun script à l'installation.
- Bun pris en charge et testé (`npm run test:bun`).
- README centré sur XPAYE ; CinetPay présenté comme secours facultatif ;
  installation avec Bun, npm, pnpm et Yarn.

## 0.3.0

- **Moyens de la documentation officielle uniquement** : XPAYE fournit les
  18 codes listés sur sandbox.paiementpro.net/test-sandbox.html. Nouveaux
  canaux : `ORANGE_SN`, `WAVE_SN`, `MOOV_TG`, `TOGOCEL_TG`, `AIRTEL_NE`,
  `ORANGE_GW`, `ORANGE_CM`, `MTN_CM`, `PAYPAL`. Un intégrateur peut surcharger
  un code via `channelCodes` (`null` retire un canal).
- XPAYE : un canal à devise locale refuse une autre devise (Cameroun : XAF).
- `ChannelInfo` : champs `currency` et `kind: 'wallet'` (PayPal).
- **Choix de l'intégrateur** : option `channels` de `PaymentClient` (liste
  blanche et ordre d'affichage) ; tout autre canal est refusé par
  `createPayment()`.
- Nouveau : `availableChannels()`, `CHANNEL_INFO`, `channelInfo()` pour
  l'écran de choix du moyen de paiement.
- **Correctif** : un `responsecode` XPAYE autre que `0` / `-1` donnait
  `failed` ; il donne maintenant `pending`.
- Montants avec séparateur de milliers (`2 000`) correctement lus.
- XPAYE : `transactionId` / `transactiondt` remonté dans `operatorReference`
  (nouveau champ de `WebhookEvent`).
- XPAYE : option `notifyTokenPrefix` et lecture de `returnContext.reference` /
  `reference_number`, pour migrer une intégration existante sans perdre les
  paiements en cours.
- XPAYE : description tronquée à 100 caractères.

## 0.2.0

Retours d'une intégration XPAYE en production.

- **Correctif** : les notifications XPAYE réelles étaient rejetées. XPAYE
  colle ses paramètres avec un second `?` derrière ceux de `notificationURL`
  (`…&nt=<jeton>?merchantId=…`), ce qui corrompait le jeton. Ce format est
  maintenant réparé.
- Les paramètres d'URL et le corps de la notification sont fusionnés (le corps
  l'emporte) ; XPAYE envoie tout dans l'URL avec un corps vide.
- XPAYE : option `secretKey`, qui vérifie le `hashcode` avec la formule
  confirmée `SHA-256(referenceNumber|amount|merchantId|clé)`, exportée sous
  le nom `computeXpayeHashcode`.
- XPAYE : un hashcode présent mais invalide fait rejeter la notification,
  même si le jeton est valide.
- XPAYE : option `requireNotifyToken` (défaut `true` si `webhookSecret` est
  fourni). Le hashcode ne signe pas le statut, il ne suffit donc pas seul.
- Le jeton `nt` n'apparaît plus dans `result.raw`.
- Nouveau : `redactFields()` pour loguer une notification sans exposer de
  signatures, de jetons ou d'e-mails.
- README : la page de retour (`returnUrl`) en lecture seule, les liens
  profonds mobiles et le sandbox XPAYE.

## 0.1.0

Première version.
