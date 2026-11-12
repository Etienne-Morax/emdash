# Emdash Mobile — piloter Emdash depuis l'iPhone

Fonction propre au fork, **désactivée par défaut**. Le bureau (Emdash ouvert sur le Mac qui
gère les machines) sert une petite app web installable et un point d'accès Wire restreint ;
le téléphone y accède **uniquement par le tailnet**, via `tailscale serve`.

```
iPhone (app sur l'écran d'accueil)
  └─ HTTPS + WebSocket — tailscale serve (TLS MagicDNS, tailnet seulement)
      └─ Emdash bureau : passerelle sur 127.0.0.1:<port> (7781 par défaut)
          └─ contrat Wire mobile (liste blanche) → contrôleurs du bureau → machines SSH
```

## Installer

1. **Activer** : Emdash → Settings → Interface → *Mobile access*. La carte affiche l'état
   (`Listening on 127.0.0.1:7781`) et le login Tailscale accepté (celui du Mac par défaut).
2. **Publier sur le tailnet** (jamais `funnel`, qui ouvrirait la passerelle à Internet) :

   ```bash
   tailscale serve --bg --https=8443 http://127.0.0.1:7781
   ```

   L'app est alors à `https://<nom-du-mac>.<tailnet>.ts.net:8443`.
3. **Ajouter à l'écran d'accueil** : ouvrir cette adresse dans Safari sur l'iPhone, Partager →
   *Sur l'écran d'accueil*, puis **ouvrir l'app installée** (son stockage est séparé de
   Safari : c'est elle qu'il faut appairer).
4. **Appairer** : sur le bureau, *Pair a phone* affiche un code de 8 caractères (10 min,
   usage unique). Le saisir dans l'app. Le téléphone reçoit un jeton d'appareil (cookie
   `HttpOnly`) ; le bureau n'en garde que le hash, dans le stockage chiffré.
5. **Révoquer** : *Revoke* à côté de l'appareil dans la même carte. Ses connexions ouvertes
   sont coupées immédiatement. Désactiver *Mobile access* arrête la passerelle.

Pour couper la publication : `tailscale serve reset`.

## Sécurité

- La passerelle n'écoute que sur `127.0.0.1` ; `tailscale serve` est la seule entrée.
- Chaque requête exige l'en-tête `Tailscale-User-Login` égal au login configuré ; les appels
  d'API et le WebSocket exigent en plus l'`Origin` `https://<MagicDNS du Mac>` et un jeton
  d'appareil valide. Tout refus répond `401` sans détail.
- Le téléphone ne voit que le **contrat mobile** : tâches, conversations (terminal de l'agent,
  ACP), création de tâche en nouveau worktree, état des machines, notifications. Jamais :
  écriture de fichiers, secrets, réglages, identifiants SSH, MCP, mises à jour, journaux bruts,
  ni paramètres de lancement des agents (dossier, arguments, shell).
- Un appareil appairé peut **taper dans le terminal de vos agents**, donc exécuter des
  commandes en votre nom sur toutes vos machines : traitez-le comme une session ouverte et
  révoquez tout téléphone perdu.
- Journal d'audit (qui, quoi, quand, résultat ; jamais les saisies, codes ni jetons) :
  `~/Library/Application Support/Emdash/mobile-remote-audit.jsonl`.

## Limites

- Le Mac qui fait tourner Emdash doit rester allumé, Emdash ouvert.
- Un processus local à ce Mac peut forger `Tailscale-User-Login` ; il lui faut quand même un
  jeton d'appareil (256 bits) ou un code d'appairage en cours.
