# Politique de sécurité

## Signaler une faille

Ne publie **pas** de faille dans une issue publique.

Utilise le signalement privé de GitHub : onglet **Security** du dépôt →
**Report a vulnerability**.

Indique :
- la version concernée ;
- l'agrégateur (XPAYE, CinetPay…) ;
- les étapes pour reproduire, avec des données **fictives** uniquement
  (jamais de vraie clé, d'identifiant marchand ou de données client).

## Ce qui est considéré comme une faille

- une notification acceptée alors qu'elle n'est pas authentifiée ;
- un paiement échoué ou d'un autre montant accepté comme réussi ;
- une fuite de clé, de jeton ou de secret (logs, `result.raw`, URL de retour…).

## Versions suivies

Seule la dernière version publiée reçoit des correctifs.
