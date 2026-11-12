# Direction artistique Morax — gabarit

Source : l'app iOS Morax OS (iPhone + iPad Mission control). Ce document fait foi pour toute app
Morax. Les valeurs vivent dans `tokens.json`. On ne recopie jamais une couleur à la main.

## L'idée en une phrase

Une **nuit bleu-violet** dans laquelle flottent des **cartes de verre teintées**. Un **seul accent chaud**
(ambre) est réservé à ce qui compte, avec des titres arrondis grands et confiants. Calme par défaut, colorée par
le sens, jamais par décoration.

## Fond

| Usage | Swift | Web |
|---|---|---|
| Écran d'accueil / tableau de bord | `MeshBackground()` (animé lentement, figé si Réduire les animations) | `.morax-mesh` |
| Écran secondaire / détail | `QuietBackground()` | `.morax-quiet` |
| Écran allumé en permanence (mur, kiosque) | `MeshBackground(isAnimated: false)` | `.morax-mesh` (déjà statique) |

Le mesh 3×3 va de l'indigo profond (haut gauche) au violet, puis à l'orange cuivré (bas droite).
En clair : bleu lavande vers pêche. **Jamais** de fond plat gris ni de blanc pur.

## Surfaces

- Tout contenu est posé sur une **carte de verre** : `.glassCard()` en Swift, `.morax-glass` sur le web.
  Rayon 28 pt pour une carte, 20 pour une tuile, 12 pour une puce, et des pilules complètes.
- **Teinter par domaine**, jamais pour décorer : `.glassCard(tint: Palette.danger)` /
  `.morax-glass.morax-tint-danger`.
  - risque, refus : `danger` (corail) ;
  - échéance proche, dégradé : `caution` (ambre jaune) ;
  - succès, approuver : `success` (vert menthe) ;
  - info, événements : `calm` (bleu) ;
  - mail : `violet` ;
  - photo, perso : `pink` ;
  - agents, système : `sky`.
- Pas d'ombre portée lourde : le relief vient du verre (flou + liseré + reflet intérieur).

## Couleur

- **`accent` (ambre `#FFB04A`) = la marque.** Il sert à l'onglet actif, à « aujourd'hui », à la ligne
  « maintenant » et aux liens d'action secondaires. Au maximum une ou deux occurrences par écran.
- Action principale destructive ou décisive : bouton plein **corail** (`danger`), texte blanc.
  Approuver : bouton plein **vert** (`success`).
- Le texte suit le schéma : `.primary` / `.secondary` en Swift, `--morax-ink` / `--morax-ink-secondary`
  sur le web. **Jamais de blanc codé en dur**, sinon le mode clair casse.
  - Exception : un écran forcé en sombre (mur).
- Mode clair **et** mode sombre sont obligatoires et doivent tous deux paraître voulus.

### Teinte texte vs teinte vive (depuis 1.1.0)

Les teintes vives (`accent`, `success`, `danger`, `caution`, `calm`, `violet`, `pink`, `sky`) servent aux
fonds, aux teintes de verre et aux glyphes posés sur fond sombre. En clair, elles tombent entre 1,3 et
2,6:1 : **jamais de texte ni de glyphe informatif en teinte vive**.

| Besoin | Swift | Web |
|---|---|---|
| Texte ou glyphe coloré | `Palette.accentText`, `.successText`, `.dangerText`, `.cautionText`, `.calmText`, `.violetText`, `.pinkText`, `.skyText` | `--morax-accent-text`… |
| Teinte de l'app (liens, sélection, contrôles) | `Palette.inkText` | `--morax-ink-text` |
| Surface de lecture opaque | `Palette.paper` | `--morax-surface-paper` |
| Surface pleine sous texte blanc | `Palette.ink` (blanc ≥ 7,2:1) | `--morax-surface-ink` |
| Texte posé sur un fond `accent` | `Palette.onAccent` (10:1) | `--morax-surface-on-accent` |

Chaque `*Text` est dynamique clair/sombre et tient ≥ 4,5:1 contre les deux arrêts de `QuietBackground`
et contre `paper`, dans son mode. `ContrastTests` le vérifie ; une nouvelle teinte qui échoue ne passe
pas. `--morax-ink` (couleur de texte web) reste ce qu'il était : la surface s'appelle `--morax-surface-ink`.

Espacements : `MoraxTokens.Space` (`xxs` 2, `xs` 4, `s` 8, `m` 12, `l` 16, `xl` 24, `xxl` 32 ;
`--morax-space-*`) plutôt que des nombres codés en dur. `Spacing` garde ses rôles nommés.

## Typographie

- **SF Pro Rounded** partout (`.moraxType()` à la racine ; `--morax-font` sur le web).
- Échelle à taille réelle :

  | Rôle | Taille | Graisse |
  |---|---|---|
  | hero | 34 | bold / 800 |
  | titre | 22 | bold |
  | headline | 17 | semibold |
  | corps | 15 | regular |
  | légende | 13 | regular |
  | eyebrow | 11 | semibold, MAJUSCULES, interlettrage 0,13 em |

- Composition type d'en-tête : eyebrow (« JEUDI 9 OCTOBRE ») puis hero (« Salut Etienne »).
  `ScreenHeader("…", eyebrow: "…")`.
- Un grand écran sert à la **densité**, pas à grossir le texte.
  - Exception : un affichage lu de loin (mur à 2–3 m), où titres et chiffres montent à 30–72 pt.

## Composants livrés

| | Swift (`import MoraxDesign`) | Web (`@morax/design`) |
|---|---|---|
| Fond | `MeshBackground`, `QuietBackground` | `.morax-mesh`, `.morax-quiet` |
| Carte | `.glassCard(tint:interactive:)` | `.morax-glass` + `.morax-tint-*` |
| En-tête | `ScreenHeader(_:eyebrow:subtitle:)` | `.morax-eyebrow` + `.morax-hero` |
| Icône ronde | `RoundIcon(symbol:tint:size:)` | — (SF Symbols n'existent pas sur le web) |
| État vide | `EmptyStateView(symbol:title:message:)` | — |
| Erreur non bloquante | `ErrorNote(_:retry:)` | `.morax-glass.morax-tint-caution` |
| Toast | `.toast($message)` | — |
| Logo | `MoraxLogo(image:size:)` (badge type icône d'app) | — |
| Boutons | `.buttonStyle(.glass)` / `.glassProminent` | `.morax-button-primary/-approve/-glass` |

## Annonces (depuis 1.1.0)

Ce qui apparaît sans que l'utilisateur l'ait demandé doit être **dit** à VoiceOver.

- `MoraxAnnouncer.announce("…")` pour un changement d'état (hors ligne, retour en ligne, « 12 résultats »,
  « Validée ») ; `.announcesOnAppear("…")` sur une vue qui apparaît avec un message.
- `.toast($message)` s'annonce, reste affiché tant que VoiceOver est actif, se ferme d'un tap ou du geste
  d'échappement, et n'utilise que l'opacité sous Réduire les animations.
- `ErrorNote` s'annonce ; son bouton Réessayer fait au moins 44 pt de haut.
- Jamais `.updatesFrequently` sur un texte transitoire : VoiceOver le relirait en boucle.

## Mouvement

- Doux et lent : mesh à 24 i/s qui dérive en 9 s ; ressorts `.smooth` / `.snappy`.
- Tout mouvement s'arrête avec Réduire les animations (y compris la pulsation d'`EmptyStateView`).
- Un écran allumé des heures n'anime rien en continu.

## Ton (textes UI)

Français, tutoiement, phrases courtes, verbes d'action : « Décider maintenant », « Plus tard »,
« Réessayer ». Les états sont nommés de la même façon partout (« Système en forme / dégradé / en panne »).

## À ne pas faire

- Une grille de cartes uniformes sans hiérarchie ;
- un dégradé décoratif sans sens ;
- un deuxième accent ;
- un texte blanc fixe ;
- une icône sans libellé d'accessibilité ;
- un composant réécrit au lieu de celui du package.
