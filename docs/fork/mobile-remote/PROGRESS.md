# Morax Code (ex-Emdash Mobile) — journal de progression

Mémoire de travail de la mission « Emdash Mobile » (piloter Emdash et toutes ses machines
depuis l'iPhone). Relire en reprenant une session compactée.

Worktree : `~/Developer/Projects/emdash-mobile`, branche `feat/mobile-remote` issue de
`origin/feat/multi-task-grid`. Chaque phase part en PR vers `feat/multi-task-grid`.

## Fait

### Phase 1 — Transport et passerelle — mergée (Etienne-Morax/emdash#3)

- `packages/wire` : codec de trames partagé (`frame-codec.ts`, extrait de `stream.ts`, même
  format binaire) et `webSocketTransport` / `openWebSocketTransport` (WHATWG `WebSocket` côté
  navigateur, `ws` côté Node). Une trame par message WebSocket, texte refusé, pair trop lent
  coupé (32 Mio en attente), compatible `reconnectingTransport`. Tests : aller-retour, 4 Mio,
  binaire, déconnexion, trame corrompue, reconnexion.
- Slice `apps/emdash-desktop/src/core/features/mobile-remote/` :
  - `api/mobile-contract.ts` : **contrat mobile = liste blanche par construction**. Mêmes
    chemins que le bureau, modèles live redéclarés sans mutations, entrées strictes là où le
    bureau a `z.custom` (`tasks.createTask`, saisie terminal plafonnée à 64 Kio, branches qui ne
    commencent pas par `-` et sans `..`).
  - `api/contract.ts` : domaine bureau `mobileRemote` (statut live, appairage, révocation,
    journal d'audit, détection Tailscale). Jamais exposé au téléphone.
  - `node/device-registry.ts` : jetons 256 bits, seul le sha256 est stocké dans le secret
    store chiffré (`mobile-remote.devices`), comparaison à temps constant, révocation.
  - `node/pairing.ts` : code 8 caractères sans ambiguïté, TTL 10 min, usage unique, brûlé
    après 5 erreurs, 10 tentatives/min au plus.
  - `node/request-auth.ts` : `Tailscale-User-Login` = login configuré (sinon détecté via
    `tailscale status --json`), `Origin` = `https://<MagicDNS de ce Mac>[:port]` ou liste
    explicite, jeton en cookie `HttpOnly; Secure; SameSite=Strict` (ou `Bearer`).
  - `node/mobile-http-server.ts` : HTTP + upgrade WebSocket sur **127.0.0.1 uniquement**,
    PWA statique (anti-traversée, CSP stricte), `/api/pair`, `/api/session`, `/api/logout`,
    `/wire`. Refus = 401 nu, raison dans l'audit. Ping 30 s.
  - `node/session-controller.ts` : un contrôleur par session téléphone,
    `createController(mobileWireContract, forwardContractImpl(...))` en validation `inputs`
    dans tous les environnements, audit de chaque appel (`denied` hors liste).
  - `node/audit-log.ts` : JSONL `userData/mobile-remote-audit.jsonl` (qui, quoi, quand,
    résultat ; jamais d'entrée, de jeton ni de code), rotation 5 Mio, saisies terminal
    échantillonnées 1/min.
  - `node/mobile-remote-service.ts` : démarre/arrête le serveur selon le réglage.
- `src/main/gateway/mobile-gateway.ts` : branche le service sur le contrôleur de routage du
  bureau (`createLazyRoutingController`, désormais exporté) via un fil Wire en mémoire.
- Réglage `mobileRemote` (off par défaut) + carte Settings → Interface → *Mobile access*
  (statut, commande `tailscale serve`, code d'appairage, appareils, révocation).

### Phase 2 — PWA lecture

- `apps/emdash-mobile` (Vite + React 19 + TS strict), DA Morax vendorisée
  (`src/styles/morax-design`, via `morax-design/scripts/apply.sh`) : nuit bleu-violet, cartes
  de verre, ambre réservé à « en attente de réponse ». `@emdash/ui` écarté : la PWA reste légère
  (195 Kio gzip) et partage contrats et helpers purs via l'alias `@core`.
- Un seul fil Wire (`reconnectingTransport` + `openWebSocketTransport`), replicas live
  (`projects.projectList`, `tasks.taskList`, `hosts.availability`) avec le hook du bureau
  `useRemoteModelState`, index des conversations alimenté par `conversations.events`.
- Statuts : logique extraite en fonctions pures
  `core/primitives/agents/api/agent-status-rollup.ts` (utilisées par le store du bureau **et**
  la PWA, plus de duplication) ; tri « en attente » d'abord (`taskAttentionRank`).
- Écrans : appairage, accueil (machines en ligne/hors ligne, tâches de toutes les machines avec
  puce machine et couleur projet), détail tâche (conversations + statut).
- Manifest, icônes (rendues depuis `public/icon.svg` par `scripts/render-icons.mjs`),
  service worker (coquille hors ligne, jamais `/api` ni `/wire`), safe areas.
- Empaquetage : le build du bureau copie `apps/emdash-mobile/dist` dans `out/mobile`
  (`scripts/copy-mobile-app.mjs`) ; en dev la passerelle sert `../emdash-mobile/dist`.
- Vérifié : base et profil isolés, `--use-mock-keychain` (trousseau verrouillé dans les shells
  d'agent), `tailscale serve --bg --https=8443 http://127.0.0.1:7781`, VM Debian du tailnet :
  401 sans jeton / faux jeton / mauvaise origine, 200 après appairage ; WebKit iPhone 15 Pro :
  appairage puis liste. Captures dans `screenshots/`.

### Phase 3 — Interagir et lancer

- Terminal de l'agent : xterm.js + `ReplicaLog` sur `conversations.tui.output` (même chemin
  que le bureau, `createXtermLogSink` réutilisé), `disableStdin` (pas de saisie directe : la
  dictée iOS duplique des mots dans xterm), barre Esc/Tab/⇧Tab/flèches/^C/⏎, compositeur
  séparé (texte puis Entrée à part, ponctuation iOS normalisée). Le téléphone prend la taille
  du PTY tant qu'il le regarde (les TUI se redessinent).
- Avant d'hydrater : job `workspaces.provision` (ce que fait `TaskManagerStore.provisionTask`
  à l'ouverture d'une tâche) — sans lui `hydrateConversation` échoue.
- Conversation par défaut = règle de la grille (`pickTaskGridConversation`), onglets si
  plusieurs, « Stop agent » (`tui.stop`) / « Resume » (ré-hydratation).
- ACP allégé : transcription récente (`loadHistory`), demandes de permission avec leurs
  options (`resolvePermission`), envoi de prompt, Stop (`cancelTurn`).
- Créer une tâche : projet (avec sa machine) → branche de base (refs live + branche par
  défaut) → agent (`agents.listMetadata`, défaut du bureau) → prompt → `tasks.createTask`
  (nouveau worktree sur nouvelle branche, nommage préfixe + suffixe comme le bureau,
  `tasks.generateTaskName`) puis provisionnement. Contrat élargi : `mobile.taskDefaults`,
  `agents.listMetadata`, `tasks.generateTaskName` (entrées bornées), `workspaces.provision`.
- Vérifié (WebKit iPhone, tailnet) : terminal live d'une tâche existante, message envoyé et
  soumis à Claude Code ; tâche créée depuis le téléphone → worktree + Claude Code lancé avec
  le prompt. Non vérifié en réel : projet SSH (même appel `createTask`), ACP (aucun agent ACP
  connecté dans l'environnement de test).

### Phase 4 — Notifications

- Web Push VAPID implémenté sur `node:crypto` (`node/web-push.ts`) plutôt qu'avec `web-push`
  (5 dépendances transitives pour ~150 lignes) : chiffrement aes128gcm RFC 8291 vérifié
  **octet pour octet** contre le vecteur de l'annexe A, JWT ES256 vérifié.
- Clés VAPID et abonnements dans le secret store chiffré ; abonnements liés à l'appareil,
  supprimés à la révocation et quand le service push répond 404/410 ; 4 au plus par appareil.
- Anti-SSRF : le bureau ne POSTe qu'aux services push connus (`*.push.apple.com`,
  `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`), https, sans
  port ni identifiants.
- Sink `mobile-push` branché sur le domaine `notifications` existant : `agent-attention`
  (en attente de réponse) et `agent-complete` (terminé), lien vers la tâche, `tag` par
  conversation. Le service de notifications livre désormais aussi les sinks « distants »
  indépendamment du focus et du son du bureau.
- PWA : carte « Turn on notifications » (geste requis par iOS ; message dédié hors écran
  d'accueil ou permission refusée), resynchronisation de l'abonnement à chaque démarrage,
  `push` / `notificationclick` dans le service worker (ouvre la tâche).
- Non vérifié en réel : réception sur un iPhone (WebKit headless n'a pas de service push).

### App iOS native (Etienne-Morax/emdash#7)

- `apps/emdash-ios` : SwiftUI + `WKWebView` autour de la PWA, adresse tailnet `https://*.ts.net`
  seulement, navigation bornée à l'origine, erreurs explicites, DA Morax, bundle
  `com.morax.emdashmobile`, `scripts/archive.sh [--upload]` (clé API d'équipe, signature cloud).
- Vérifié : tests Swift (3), simulateur chargeant la passerelle via le tailnet, archive Release
  et export `.ipa` signé. Bundle ID enregistré par l'API.

### Phase 5 — Revue et pull request (branche `feat/mobile-review`)

- Contrat mobile élargi, entrées strictes : `sourceControl.checkout.model` (état `head` seul,
  sans mutations), `getChangedFiles` (`working-vs-head` ou `merge-base` seulement), `getFile`
  (objets git commités seulement : `head` ou commit/branche, jamais l'arbre de travail ni un
  tag), `getLog` (≤ 500 commits), `publish` (push `--set-upstream` sous le même nom, jamais
  forcé, sans identifiants : `.strict()`). Commits = hex 7-64, branches = `mobileBranchNameSchema`,
  chemins relatifs sans remontée.
- `mobile.pullRequests.forBranch` / `create` servis par la passerelle : le téléphone donne
  projet, branches, titre, description, brouillon ; l'URL du dépôt vient toujours de
  `repository.resolveProvider` côté bureau (jamais du téléphone), puis
  `pullRequests.getPullRequestsForBranch` / `createPullRequest` (mêmes appels que la modale
  *Create PR* du bureau).
- PWA : bouton *Changes* sur la tâche → écran de revue (commités depuis la base de fusion
  avec `origin/<défaut>`, diff ligne à ligne Myers borné calculé sur le téléphone ;
  non commités en compteurs seulement), lien vers la PR ouverte sinon formulaire
  (publication si la branche manque ou est en avance, puis création).
- Revue sécurité (agent `security-reviewer`) : `publish` acceptait un chemin comme remote
  (git pousse alors vers n'importe quel dépôt local, hooks compris). Corrigé : nom de remote
  sans `/`, `:` ni `.` initial (`mobileRemoteNameSchema`) ; les refs de revue refusent
  `refs/*` (`refs/stash`, tags) et `*HEAD`. Tests de refus ajoutés.
- `git push` sans upstream échoue : on publie (`publish`) plutôt que pousser, ce qui corrige
  aussi une branche qui suit sa base (`origin/main`).
- Vérifié (build, WebKit iPhone, tailnet `tailscale serve` puis `reset`) : tâche créée depuis
  le téléphone, commit dans son worktree, revue : 2 fichiers commités, diff d'un fichier,
  1 fichier non commité, erreur PR explicite (dépôt de démo à remote local, sans hôte GitHub).
  Captures `screenshots/phone-review*.png`. Worktree de test retiré.
- Non vérifié en réel : publication et création d'une vraie PR (évite une PR parasite sur un
  vrai dépôt) — couvert par tests unitaires et appels identiques à ceux du bureau.
- Porte : format, lint, typecheck verts ; tests : échecs préexistants seulement
  (`tmux.test.ts`, `open-in-apps`, `machine-details-page.browser.test.tsx` qui importe
  `getProjectSshConnectionId` absent de la base), tests navigateur instables relancés verts.

### Changement de cap (2026-11-12) : app iOS native « Morax Code »

Demande d'Etienne (relayée par la session parente) : remplacer la PWA par une vraie app iOS
native. Garder la phase 1 (transport WebSocket, passerelle, `tailscale serve`, jeton +
`Tailscale-User-Login`, audit) ; la passerelle ne sert plus la PWA.

Fait (branche `feat/morax-code-ios`) :
- `apps/morax-code-ios` : SwiftUI iOS 26, Swift 6 strict, XcodeGen. Package local
  `MoraxWire` (client Wire : trames, appels, états live + patches Immer, logs live, flux
  d'événements, jobs) et `MoraxCodeKit` (adresse/appairage, modèles, tableau des tâches,
  règles de statut, création de tâche, compositeur). SwiftTerm 1.18.0 (MIT ; 1.99 ajoute un
  plugin de build à approuver), MoraxDesign. Icône 1024 depuis `Logo/Coding center.png`
  (sips).
- Fixtures partagées TS ↔ Swift : session Wire enregistrée (trames exactes) depuis
  `packages/wire`, table des endpoints du contrat mobile, règles de statut évaluées par les
  fonctions TS du bureau sur tous les petits cas. Tests des deux côtés.
- Couleurs projet/machine résolues par le bureau (`mobile.colors`) : l'app ne réimplémente
  pas les règles.
- Appairage par QR (`moraxcode://pair?gateway=…&code=…`) dans Settings → Mobile access :
  générateur QR de Nayuki vendorisé (MIT, fichier unique, aucune dépendance npm), QR décodé
  par CoreImage pour vérifier. Jeton dans le Trousseau, envoyé en `Bearer`.
- Notifications locales tant que l'app est connectée ; APNs laissé en TODO documenté.
- PWA (`apps/emdash-mobile`), coquille WKWebView (`apps/emdash-ios`) et service statique de
  la passerelle retirés (CSP `default-src 'none'`, toute page → 404).
- Vérifié sur simulateur (iPhone 18 Pro, iOS 27.2) contre l'instance de dev isolée via
  `tailscale serve` : appairage par lien QR, accueil live, tâche créée depuis l'app
  (`polite-news-film`), terminal Claude Code en direct, message envoyé et soumis, statut
  « Waiting for you » (`MoraxCodeUITests`, opt-in `MORAX_LIVE_DESKTOP=1`). Captures
  `screenshots/ios-*.png`. Ensuite : `tailscale serve reset`, instance arrêtée, worktrees
  de test retirés.

Reste :
- Écran de revue (diff + PR) dans l'app native (contrat déjà prêt côté bureau).
- APNs (compte payant + expéditeur) ; le service Web Push VAPID du bureau n'a plus de client.
- Installation sur l'iPhone réel (Xcode, équipe personnelle) et vérification sur l'appareil.

## Reste (bloqué / suites)

- TestFlight : hors périmètre (consigne : pas d'envoi TestFlight / App Store).
- Notifications dans l'app native : APNs (clé APNs du compte développeur) ; d'ici là, la PWA
  sur l'écran d'accueil reçoit les notifications.
- Réception push réelle sur iPhone, projet SSH et ACP à confirmer sur l'appareil.
- PR depuis un fork (push vers un autre dépôt que la cible) et diff de l'arbre de travail :
  non gérés sur le téléphone.
- QR d'appairage (non fait : saisir le code suffit, la caméra ouvrirait Safari et non l'app).
- Passerelle directe sur le workspace-server de chaque machine pour ne plus dépendre du Mac.

## Nettoyage fait (2026-11-12)

- `tailscale serve reset` (plus aucune config serve), app de dev et simulateur arrêtés,
  worktrees du dépôt de démo retirés de `~/emdash/worktrees`. La base et le profil de test
  restent dans `/tmp/emdash-mobile*` (jetables).

## Décisions

- **Réutiliser Wire de bout en bout** : la passerelle sert un contrat Wire restreint, pas un
  pont maison. La liste blanche est le contrat lui-même (pas de filtre de chaînes à part).
- `ws@8.21.0` ajouté au bureau (déjà présent en transitif, MIT, sans script d'installation) ;
  `@types/ws` en dev. L'ajout d'un importeur fait ré-résoudre le pair optionnel `prettier` de
  Storybook (2.8.8 → 3.9.9) dans `pnpm-lock.yaml` : bénin, inévitable avec `pnpm install`.
- Jeton en cookie HttpOnly plutôt qu'en `localStorage` : inaccessible au JS (XSS), envoyé
  aussi sur l'upgrade WebSocket (le navigateur ne permet pas d'en-tête custom).
- Origine acceptée = https sur le nom MagicDNS de ce Mac, quel que soit le port
  `tailscale serve`.
- `tui.startSession` / `resume` (cwd, args, shellSetup arbitraires) **jamais** exposés :
  démarrer/reprendre passe par `conversations.hydrateConversation` (config résolue côté bureau).
- Les mutations des modèles live (renommer, archiver, branches…) ne sont pas exposées.

## Idées reprises (lecture, pas de code copié)

- `AltanS/collie` (MIT) : code d'appairage court à usage unique, 5 essais, limitation de
  débit, seul le hash du jeton stocké, journal d'audit sans code ni jeton, `tailscale serve`
  jamais `funnel`, appairer dans l'app installée (stockage séparé de Safari).

## Blocages

- Aucun.
