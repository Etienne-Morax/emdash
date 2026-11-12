# Morax Code — piloter Emdash depuis l'iPhone

Fonction propre au fork, **désactivée par défaut**. Le bureau (Emdash ouvert sur le Mac qui
gère les machines) ouvre un point d'accès Wire restreint ; l'app iOS native **Morax Code**
(`apps/morax-code-ios`) s'y connecte **uniquement par le tailnet**, via `tailscale serve`.

```
iPhone (Morax Code, SwiftUI)
  └─ HTTPS + WebSocket — tailscale serve (TLS MagicDNS, tailnet seulement)
      └─ Emdash bureau : passerelle sur 127.0.0.1:<port> (7781 par défaut)
          └─ contrat Wire mobile (liste blanche) → contrôleurs du bureau → machines SSH
```

L'app parle le protocole Wire (trames binaires + JSON, modèles live en patches Immer) sur
`URLSessionWebSocketTask`. Le client Swift (`Packages/MoraxWire`) est vérifié contre des
fixtures enregistrées depuis l'implémentation TypeScript (`apps/morax-code-ios/Fixtures`) :
un changement de protocole ou de contrat casse les tests des deux côtés.

## Installer

1. **Activer** : Emdash → Settings → Interface → *Mobile access*. La carte affiche l'état
   (`Listening on 127.0.0.1:7781`) et le login Tailscale accepté (celui du Mac par défaut).
2. **Publier sur le tailnet** (jamais `funnel`, qui ouvrirait la passerelle à Internet) :

   ```bash
   tailscale serve --bg --https=8443 http://127.0.0.1:7781
   ```

3. **Installer Morax Code** sur l'iPhone depuis Xcode (signature automatique, équipe
   personnelle) : voir `apps/morax-code-ios/README.md`. Tailscale doit être actif sur
   l'iPhone.
4. **Appairer** : sur le bureau, *Pair a phone* affiche un QR code et un code de
   8 caractères (10 min, usage unique). Scanner le QR dans l'app (ou avec l'appareil photo,
   qui ouvre l'app), ou saisir l'adresse `<nom-du-mac>.<tailnet>.ts.net:8443` et le code.
   Le jeton d'appareil (256 bits) est rangé dans le Trousseau de l'iPhone ; le bureau n'en
   garde que le hash, dans le stockage chiffré.
5. **Notifications** : autoriser à l'appairage. Tant que l'app est connectée, une
   notification locale arrive quand un agent attend une réponse, a fini ou a échoué ; la
   toucher ouvre la tâche.
6. **Révoquer** : *Revoke* à côté de l'appareil sur le bureau, ou *Unpair this iPhone* dans
   l'app. Les connexions ouvertes sont coupées immédiatement.

Pour couper la publication : `tailscale serve reset`.

## Ce que fait l'app

- Accueil : machines (en ligne / hors ligne), tâches de tous les projets de toutes les
  machines, « en attente de réponse » d'abord, couleurs projet et machine du bureau.
- Tâche : terminal de l'agent en direct (SwiftTerm, lecture seule), barre Esc / Tab / ⇧Tab /
  flèches / ^C / ⏎, compositeur natif (dictée) ; conversations chat (ACP) : transcription,
  réponse en cours, permissions, envoi, stop ; arrêter / reprendre l'agent.
- Nouvelle tâche : projet (et sa machine) → branche de base → agent → prompt ; même appel
  `tasks.createTask` que le bureau (nouveau worktree sur nouvelle branche).

## Sécurité

- La passerelle n'écoute que sur `127.0.0.1` ; `tailscale serve` est la seule entrée. Elle ne
  sert plus aucune page : seulement `/api/pair`, `/api/session`, `/api/logout` et `/wire`.
- Chaque requête exige l'en-tête `Tailscale-User-Login` égal au login configuré ; les appels
  d'API et le WebSocket exigent en plus l'`Origin` `https://<MagicDNS du Mac>` et un jeton
  d'appareil valide (`Authorization: Bearer`). Tout refus répond `401` sans détail.
- L'app n'accepte qu'une adresse `https://*.ts.net` (jamais une adresse publique).
- Le téléphone ne voit que le **contrat mobile** : tâches, conversations (terminal de l'agent,
  ACP), création de tâche en nouveau worktree, état des machines, couleurs résolues, revue
  (contenu **commité** d'un worktree de tâche, publication non forcée de sa branche, création
  de PR dans le dépôt résolu par le bureau). Jamais : écriture de fichiers, secrets, réglages,
  identifiants SSH, MCP, mises à jour, journaux bruts, ni paramètres de lancement des agents.
- Un appareil appairé peut **taper dans le terminal de vos agents**, donc exécuter des
  commandes en votre nom sur toutes vos machines : traitez-le comme une session ouverte et
  révoquez tout téléphone perdu.
- Journal d'audit (qui, quoi, quand, résultat ; jamais les saisies, codes ni jetons) :
  `~/Library/Application Support/Emdash/mobile-remote-audit.jsonl`.

## Limites

- Le Mac qui fait tourner Emdash doit rester allumé, Emdash ouvert.
- Notifications seulement quand l'app est connectée (iOS suspend le WebSocket en arrière-plan).
  Les notifications push à distance demandent APNs (compte développeur payant et un
  expéditeur) : non fait, voir `apps/morax-code-ios/README.md`.
- L'écran de revue de diff et de PR existe côté bureau (contrat) mais pas encore dans l'app
  native.
- Un processus local à ce Mac peut forger `Tailscale-User-Login` ; il lui faut quand même un
  jeton d'appareil (256 bits) ou un code d'appairage en cours.
