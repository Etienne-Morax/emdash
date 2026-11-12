# Audit iOS/iPadOS — Morax Code (`apps/morax-code-ios`)

**Verdict : prêt pour TestFlight, 0 blocker confirmé.** Build simulateur OK (Xcode 27.2, SDK 27.2, projet régénéré dans une copie). Tests et lancement sur simulateur non exécutés.

Mode : audit seul, aucun fichier du dépôt modifié.

## Script `ios_audit.py`

Exit code 1 (1 warning, 3 infos). Triage :

| Signal | Décision |
|---|---|
| swiftlint 66 erreurs / 95 warnings (règles par défaut, pas de config) | Info, selon consigne. Config absente, à ajouter (voir Qualité). |
| swiftformat 34/34 fichiers | Info. Pas de `.swiftformat`. |
| rgb-color `HomeView.swift:93`, `Components.swift` | Faux positif : `Color(hex: row.projectColor)` vient des données du Mac, pas un littéral. |
| rgb-color `AgentTerminal.swift:111-112` | Accepté : `UIColor` requis par le `TerminalView` SwiftTerm (UIKit). |
| signal-scaled-metric (0) | Confirmé partiellement, voir Accessibilité (terminal). |
| Les autres `ok` | Confirmés (voir ci-dessous). |

## Blockers

Aucun. Vérifié :

- `UIDeviceFamily` = 1, 2 ; SDK 27.2 au build ; icône 1024×1024 présente.
- `NSCameraUsageDescription` présent, et utilisé (`PairingView.swift:116-125`, VisionKit).
- Chiffrement : `ITSAppUsesNonExemptEncryption = NO` correct (HTTPS/WSS uniquement).
- ATS : gateway forcée en `https` (`GatewayAddress.swift:27`), pas d'exception ATS.
- Manifeste de confidentialité : `MoraxCode/PrivacyInfo.xcprivacy` embarqué dans le bundle. Les accès UserDefaults sont dans du code `#if DEBUG` uniquement (`MoraxCodeApp.swift:17,27`). Aucun API à raisons requises dans les sources de SwiftTerm, morax-design ni swift-argument-parser (hors outils/exemples).
- Notifications : permission demandée après appairage, en contexte (`PairingView.swift:108`). Pas d'APNs, pas d'entitlement.
- Secrets : token en Keychain, `ThisDeviceOnly` (`Keychain.swift:34`). `*.xcodeproj` et `.xcconfig` ignorés, rien de sensible suivi.
- Cycle de vie : `App` SwiftUI + `WindowGroup`, pas de `UIRequiresFullScreen`. Pas de `UISceneDelegate` requis dans ce cas. Lancement non vérifié sur simulateur.

## iPhone

- Pas de problème bloquant. Navigation `NavigationStack` avec `path` (`MoraxCodeApp.swift:117`), swipe retour non bloqué.
- Hit target des boutons Envoyer/Stop sous 44 pt : voir Accessibilité.

## iPad

- OK : `NavigationSplitView` en `.regular` avec colonne 320/380/460 (`MoraxCodeApp.swift:103`), repli en `NavigationStack` en compact, tailles de police et largeurs de colonne lues par `horizontalSizeClass` (pas par idiome). Formulaires et pairing bornés à 560/720 pt.
- OK : ⌘N dans le menu (`MoraxCodeApp.swift:41-46`), ⌘↩ envoyer (`ChatPanel.swift:171`, `AgentTerminal.swift:193`), `hoverEffect` sur les cartes (`HomeView.swift:33-34`).
- Faible : le raccourci ⌘. d'arrêt (`ChatPanel.swift:160`) est attaché à un bouton qui n'existe que pendant la génération. Le déplacer dans `.commands` si on veut qu'il soit visible au menu.
- Non vérifié : rendu en fenêtre étroite Stage Manager, et Dynamic Type XXL (pas de captures).

## Accessibilité

| Sév. | Règle | Preuve | Correctif | Effort |
|---|---|---|---|---|
| Haute | Cible tactile < 44 pt | `ChatPanel.swift:157-172` (Stop, Envoyer : `Image.font(.title)` sans cadre) ; `AgentTerminal.swift:185-191` | `.frame(minWidth: 44, minHeight: 44).contentShape(.rect)` | S |
| Moyenne | Texte non dimensionnable | `AgentTerminal.swift:104-106,113,120` : `monospacedSystemFont(ofSize: 11/13)` | `UIFontMetrics(forTextStyle: .body).scaledFont(for: …)` ou réglage utilisateur | S |
| Moyenne | Champ sans libellé VoiceOver (placeholder seul) | `PairingView.swift:36` (adresse du Mac) ; l'eyebrow `:35` n'est pas lié | `.accessibilityLabel("Mac address")` | S |
| Info | Reduce Motion | Aucune animation custom (`grep` vide) | Rien à faire | — |
| Info | Dark Mode | `.preferredColorScheme(.dark)` (`MoraxCodeApp.swift:14`), choix de DA, couleurs via `Palette` | Rien à faire | — |

## Code SwiftUI (swiftui-pro)

| Sév. | Règle | Preuve | Correctif | Effort |
|---|---|---|---|---|
| Moyenne | `Binding(get:set:)` dans `body` | `TaskScreen.swift:36`, `NewTaskScreen.swift:43` | `@State` + `$selected`, `.tag` sur un `String?` | S |
| Moyenne | Objets de session recréés à chaque `body` et stockés en `@State var` depuis le parent | `TaskScreen.swift:46-57` construit `ChatSession`/`TerminalSession` à chaque rendu ; `ChatPanel.swift:106` et `AgentTerminal.swift:150` les gardent en `@State var`. Les nouvelles instances sont jetées, et `workspaceId` mis à jour n'est pas repris | Garder la session dans un `@State` du parent, indexée par `conversationId`, et passer `let` au enfant | M |
| Moyenne | Erreurs avalées sur action utilisateur | `MoraxCodeApp.swift:60` (`try? model.pair(link)` : un lien QR raté ne montre rien) ; `NewTaskScreen.swift:78-79` (agents/défauts : bouton « Create task » désactivé sans explication) ; `TaskScreen.swift:73-75` (Stop agent) ; `AgentTerminal.swift:82-98` (envoi de touches) | Afficher une erreur ou un message ; au minimum `do/catch` avec état | S-M |
| Moyenne | Scanner QR sans erreur | `PairingView.swift:123` `try? scanner.startScanning()` : permission refusée = feuille noire. Ajouter `DataScannerViewController.isAvailable` et un message | S |
| Faible | Plusieurs types par fichier | `MoraxCodeApp.swift` (App, Route, RootView) ; `HomeView.swift` (HomeView, TaskCard) ; `ChatPanel.swift` (ChatSession, ChatPanel) ; `AgentTerminal.swift` (5 types) ; `Components.swift` (Color, StatusPill, MachineChip, OfflineBanner) ; `PairingView.swift` (PairingView, QRScanner) | Un type par fichier, déplacement pur | S |
| Faible | `some View` calculés dans `body` | `HomeView.swift:61` (`machines`), `:74` (`machineCard`), `MoraxCodeApp.swift:99` (`navigation`), `:124` (`destination`) | Extraire en `struct View` | M |
| Faible | `ScrollView(…, showsIndicators: false)` | `HomeView.swift:62`, `AgentTerminal.swift:168` | `.scrollIndicators(.hidden)` | S |
| Faible | `.keyboardShortcut` sur vue éphémère | `ChatPanel.swift:160` | Voir iPad | S |

Non retenu : `.onChange` (les variantes 0 et 2 paramètres sont conformes), `Task.sleep(for:)`, `@Observable` marqués `@MainActor` (`AppModel.swift:10`, `ChatPanel.swift:7`, `AgentTerminal.swift:15`), `AgentNotifier` avec délégué `nonisolated`. `NavigationView`, `foregroundColor`, `cornerRadius`, `tabItem`, `GeometryReader`, `AnyView`, `UIScreen` : absents.

## Qualité du code

- Pas de `.swiftlint.yml` ni `.swiftformat`. Proposer la config Airbnb plutôt que reformater le dépôt en silence (règle du projet). Décision à prendre par Etienne.
- `project.yml:9` : `SWIFT_VERSION: "6.0"`. La cible de référence est Swift 6.2 : à monter (S).
- `DemoData.swift:53` : `try!` sur un JSON statique, dans `#if DEBUG`. Acceptable.
- `Packages/MoraxWire/Sources/MoraxCodeKit/TerminalKeys.swift:28-29` : `replacingOccurrences` (remplacer par `replacing(_:with:)`). `JSONValue.swift:149` : `String(format:)` pour de l'hexa, acceptable. Faible.
- Tests : `scripts/test.sh` existe (paquets + iPhone + iPad). Non exécuté ici.

## Opportunités (WWDC26)

- Swipe actions (Arrêter / Reprendre) sur les cartes de tâches (`swipeActions` sur `HomeView`), utile sur iPhone et en sidebar iPad.
- `.commands` plus riche sur iPad : ⌘R (rafraîchir), ⌘. (arrêter l'agent) au lieu de `ChatPanel.swift:160`.
- `ToolbarOverflowMenu` / `visibilityPriority` sur la barre de `TaskScreen` (action « Agent » déjà en menu, peu d'enjeu).

## Top 5 actions

1. **Cibles 44 pt** sur Envoyer et Stop (`ChatPanel.swift:157-172`, `AgentTerminal.swift:185-191`). S.
2. **Remonter les échecs** : scanner QR (`PairingView.swift:123`) et appairage par lien (`MoraxCodeApp.swift:60`). S.
3. **Propriété des sessions** : `TaskScreen.swift:46-57` + `ChatPanel.swift:106` + `AgentTerminal.swift:150`. M.
4. **Supprimer `Binding(get:set:)`** : `TaskScreen.swift:36`, `NewTaskScreen.swift:43`. S.
5. **Accessibilité texte** : police terminal non dimensionnable (`AgentTerminal.swift:104-120`) et libellé de l'adresse (`PairingView.swift:36`). S.

Ensuite (hors blocker) : un type par fichier, config SwiftLint/SwiftFormat, Swift 6.2.

## Non vérifié

- Tests unitaires et UI non lancés (`scripts/test.sh` non exécuté).
- Lancement sur simulateur, Dynamic Type XXL, Stage Manager : pas de capture faite.
- `MoraxDesign` (`Palette`, `.moraxCaption`, `glassCard`) : package distant, non inspecté ; supposé sémantique.
- Captures App Store iPad : non vérifiées (exigées pour une app universelle).
