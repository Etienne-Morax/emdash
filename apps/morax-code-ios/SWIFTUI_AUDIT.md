# Audit SwiftUI — MoraxCode (app iOS Morax Code) — 2026-11-12

Commit audité : `759700aaa` (`feat/multi-task-grid`). Analyse statique, quatre auditeurs en parallèle.

## Synthèse

| Domaine | Score | Constats (H/M/L) |
|---|---|---|
| Liquid Glass & HIG | 61/100 (55/90) | 1/2/2 |
| Architecture moderne | 73/100 (44/60) | 3/4/3 |
| IA on-device (Foundation Models) | n/a | 0/0/0 |
| Performance & mémoire | 60/100 | 2/3/3 |
| **Global** (moyenne des domaines applicables) | **65/100** | **6/9/8** |

Profil : app iOS/iPadOS 26.0, Swift 6.0 en concurrence stricte, projet XcodeGen, `@Observable` partout (aucun `ObservableObject`). Packages : MoraxWire (client Wire WebSocket) et MoraxCodeKit en local, MoraxDesign et SwiftTerm en externe. Pas de SwiftData ni de Foundation Models.

La base est moderne et propre. Les faiblesses se concentrent sur trois points :
1. Le flux « New task » : chargement sans fin et races, cause probable du crash signalé.
2. Les vues recalculent le tableau des tâches à chaque rendu.
3. Le verre est appliqué à des cartes de contenu qui défilent sous une barre elle-même en verre.

## Plan d'action priorisé

| id | Domaine | Fichier:ligne | Problème | Correctif | Effort | Auto-fix |
|---|---|---|---|---|---|---|
| PERF-01 | perf | Packages/MoraxWire/Sources/MoraxWire/AgentStatus.swift:100-103 | 1 à 2 `ISO8601DateFormatter` alloués par appel de `StatusRules.time`. Il est appelé pour chaque date de chaque tâche à chaque lecture de `model.board` depuis `body` | Formatters `static let` (ou `Date.ISO8601FormatStyle`) | S | oui |
| ARCH-01 | arch | MoraxCode/Screens/NewTaskScreen.swift:71-81 | `projectId` reste vide si les projets ne sont pas encore chargés. `.task` ne se relance pas, donc `loadBranches()` n'est jamais appelé : « Loading… » sans fin | `.task(id: model.projects.map(\.id))`, appel direct de `loadBranches()` | S | non |
| ARCH-02 | arch | MoraxCode/Screens/NewTaskScreen.swift:83-101 | `try?` avale les erreurs de chargement des branches, agents et valeurs par défaut, sans état d'erreur | Enum loading/loaded/failed et bouton « Réessayer » | M | non |
| ARCH-03 | arch | MoraxCode/Screens/NewTaskScreen.swift:72, 83-94 | `Task` non structurée jamais annulée : abonnement qui fuit, `refs` d'un autre projet, follower non arrêté à la fermeture | `.task(id: projectId)`, `stop()` dans `onDisappear`, annulation dans `start()` | M | non |
| PERF-02 | perf | MoraxCode/App/AppModel.swift:42-47 | `board` est recalculé (tri, regroupement, parsing ISO) à chaque lecture depuis HomeView et TaskScreen | Propriété stockée recalculée sur changement, et lookup `statusRow(taskId:)` | M | non |
| GLASS-01 | glass | MoraxCode/Screens/HomeView.swift:82, 105 (+ ChatPanel, PairingView, Components) | Cartes de contenu en Liquid Glass sous une barre de navigation en verre : verre sur verre, et matériaux dans le verre | Dans `morax-design`, faire de `glassCard` une surface de contenu et réserver le verre aux contrôles flottants | M | non (décision design) |
| ARCH-05 | arch | Packages/MoraxWire/Sources/MoraxWire/ImmerPatch.swift:50, 84 | `Int(double)` plante sur NaN, l'infini ou une valeur hors bornes venant du réseau. Suspect principal du crash | `Int(exactly:)` et lever `.badPath` | S | oui (transmis à la session iOS) |
| ARCH-04 | arch | Packages/MoraxWire/Sources/MoraxWire/WireConnection.swift:124-137 | `request()` n'a ni gestion d'annulation ni timeout | `withTaskCancellationHandler` et timeout par appel | M | non |
| ARCH-06 | arch | Packages/MoraxWire/Sources/MoraxWire/LiveFollowers.swift:38-72 | Des `resync()` peuvent se chevaucher, et un patch raté peut relancer des resyncs sans fin | Un seul `resyncTask` partagé, nombre d'échecs plafonné | M | non |
| ARCH-07 | arch | MoraxCode/Screens/NewTaskScreen.swift:124-127 | Réponse `createTask` invalide et provisioning raté ignorés en silence | Message d'erreur, provisioning suivi dans `AppModel` | S | non |
| PERF-03 | perf | LiveFollowers.swift:39, 93 ; AgentTerminal.swift:56-57 ; ChatPanel.swift:42 | Une `Task` par chunk ou update : allocations, et ordre non garanti (terminal corrompu, resyncs parasites) | `AsyncStream` avec un seul consommateur, chunks terminal regroupés | M | non |
| PERF-04 | perf | MoraxCode/Screens/ChatPanel.swift:124-125, 38-52 | `liveText` est recalculé deux fois par patch, et le JSON est sérialisé à chaque patch | Propriétés stockées mises à jour seulement quand elles changent | S | non |
| PERF-05 | perf | MoraxCode/App/AppModel.swift:222-235 | Chaque patch de la liste des projets refetch les conversations de tous les projets | Comparer la liste et ne charger que les nouveaux projets | S | non |
| GLASS-02 | glass | MoraxCode/Screens/HomeView.swift:55-63 | Cartes en verre adjacentes sans `GlassEffectContainer` | `GlassEffectContainer(spacing: 8)`, ou retirer le verre (selon GLASS-01) | S | non |
| GLASS-03 | glass | ChatPanel.swift:139-171 ; AgentTerminal.swift:173, 190-196 ; PairingView.swift:55, 73 | Actions flottantes en `.bordered`/`.borderedProminent` ou icônes nues | `.glass` / `.glassProminent` | S | non |
| PERF-06 | perf | MoraxCode/Screens/TaskScreen.swift:~45-50 | `ChatSession`/`TerminalSession` est alloué à chaque évaluation de `body` | Création dans `init` d'une vue wrapper ou dans `.task(id:)` | S | non |
| PERF-07 | perf | Packages/MoraxWire/Sources/MoraxWire/FrameCodec.swift:37-49 | Chaque frame est copiée 2 à 3 fois | `withUnsafeBytes` / `RawSpan`, slices de `Data` | S | non |
| PERF-08 | perf | Packages/MoraxWire/Sources/MoraxWire/WireConnection.swift:57-63, 126-134 | La boucle de lecture garde `self` en vie. Une `Task` est créée par envoi | Sortie sur annulation, envoi inline | S | non |
| GLASS-04 | glass | ChatPanel.swift:152-155 ; AgentTerminal.swift:183, 208 ; PairingView.swift:42, 49 | Rayon 12 codé en dur, non concentrique | `.capsule` ou `.containerConcentric` | S | non |
| GLASS-05 | glass | MoraxCode/Screens/ChatPanel.swift:139-141 | Allow et Deny sont tous deux proéminents et colorés | Une seule action teintée | S | non |
| ARCH-08 | arch | MoraxCode/Screens/NewTaskScreen.swift:8-134 | Réseau, durée de vie du follower et 8 `@State` dans la vue | `NewTaskModel` `@Observable` avec tests de transitions | M | non |
| ARCH-09 | arch | MoraxCode/ | Aucun `#Preview` | Previews avec `AppModel` démo | S | non |
| ARCH-10 | arch | apps/morax-code-ios/AGENTS.md (absent) | Pas d'`AGENTS.md` ni de `journal.md` propres à l'app | `AGENTS.md` court et `journal.md` | S | non |

Note : ARCH-01, -02, -03, -05, -06 et -07 touchent le flux « New task » en cours de correction sur la branche `fix/morax-code-new-task-crash`. Ils ont été transmis à cette session et sont exclus des correctifs de cet audit.

## Détail par domaine

### Liquid Glass & HIG — 55/90

| # | Critère | Score | Preuves |
|---|---|---|---|
| 1 | Règle des trois couches | 6/15 | `glassCard()` (MoraxDesign) sur du contenu qui défile : HomeView:82/105, ChatPanel:121/127/146, PairingView:64, Components:70. `.thinMaterial` dans une carte en verre (PairingView:42-49) |
| 2 | GlassEffectContainer | 4/15 | Aucun. Cartes adjacentes : HomeView:55-63, ChatPanel:111-127 |
| 3 | Concentricité | 10/15 | Token `Radius.card` réutilisé, mais 12 codé en dur dans les champs |
| 4 | Retenue chromatique | 12/15 | Toolbars sobres, tint global. Bulles teintées, Allow et Deny tous deux colorés |
| 5 | Extension sans rognage | n/a | Pas d'image hero ; fonds décoratifs plein écran |
| 6 | Groupes sémantiques de toolbar | 8/10 | Un item par placement, `Label` avec icône |
| 7 | Sheets translucides et zoom | 8/10 | Une seule sheet (scanner QR), sans zoom applicable |
| 8 | Interactivité native | 7/10 | `TaskCard` interactive. Boutons `.bordered` au lieu de `.glass` |

Leads rejetés : les 5 `GLASS-IGNORES-SAFE-AREA` (MoraxCodeApp:77, HomeView:15, PairingView:20 et :89, TaskScreen:25). Ce sont des fonds décoratifs plein écran ou une caméra QR : usage correct.

### Architecture moderne — 44/60

| # | Critère | Score | Preuves |
|---|---|---|---|
| 1 | Zéro ObservableObject | 20/20 | `@MainActor @Observable final class AppModel` (AppModel:10-11), `@Environment(AppModel.self)` |
| 2 | Syntaxe ContentBuilder | 15/15 | Pas de concaténation `Text + Text` |
| 3 | Interactions de collection | n/a | — |
| 4 | Prédicats SwiftData | n/a | — |
| 5 | Previews isolées | 7/15 | Démo derrière `#if DEBUG`, mais aucun `#Preview` |
| 6 | Cache AsyncImage | n/a | — |
| 7 | Gouvernance agentique | 2/10 | Pas d'`AGENTS.md` ni de `journal.md` dans l'app |

Rejetés : double reprise de continuation dans WireConnection (impossible via `removeValue`), binding du picker `base?.id ?? ""` (valide), `Task { @MainActor in refs = value }` (compile en Swift 6 ; le problème est sa durée de vie, ARCH-03). La cause exacte du crash n'est pas confirmée statiquement : ARCH-05 est la plus probable, puis les races ARCH-03 et ARCH-06.

### IA on-device — n/a

Aucun usage de FoundationModels. Pistes, chacune derrière `SystemLanguageModel.default.availability` :
- Titre de tâche généré depuis le prompt (NewTaskScreen:54).
- Résumé « ce qui a changé » d'un diff.
- Réponses rapides aux questions de l'agent (ChatPanel:152, AgentTerminal:179).

### Performance & mémoire — 60/100

| # | Critère | Score | Preuves |
|---|---|---|---|
| 1 | Budget de frame et coût de `body` | 12/20 | `model.board` est recalculé dans `body` (HomeView:22, TaskScreen:26). `liveText` est calculé deux fois (ChatPanel:124-125) |
| 2 | Pas d'allocation lourde dans `body` | 6/15 | Formatters ISO alloués par appel (AgentStatus:100-103) |
| 3 | Granularité `@Observable` | 9/15 | `AppModel` monolithique ; les sessions par écran sont bien séparées |
| 4 | Protection de `@Environment` | 14/15 | Seul `.environment(model)` |
| 5 | Copies O(N) cachées | 13/15 | `FrameCodec.decode` copie 2 à 3 fois |
| 6 | InlineArray / Span | 6/20 | `[UInt8]` au lieu de `RawSpan` |

Rejetés : boucles de réception WebSocket correctes, pas de fuite d'abonnement ni de cycle de rétention (`[weak self]` partout), `feed` SwiftTerm par chunk acceptable.

## Limites

- Les API iOS 26/27 citées (`.glass`, `.glassProminent`, `.containerConcentric`, `RawSpan`, `Date.ISO8601FormatStyle`) n'ont pas été vérifiées contre le SDK installé ; le build les validera.
- Le style de verre vient de MoraxDesign (dépôt externe) : GLASS-01 se corrige là-bas, pas dans l'app.
- Analyse statique uniquement : aucune mesure Instruments (hitches, allocations), aucun rendu à l'écran vérifié, le crash n'a pas été reproduit.

## Correctifs appliqués

Branche `swiftui-audit/2026-11-12`, créée depuis `origin/feat/multi-task-grid` (`759700aaa`). Option choisie : correctifs sûrs.

- **Appliqué :** PERF-01. Les deux `ISO8601DateFormatter` de `StatusRules.time` sont en cache `static`. Un test de non-régression couvre les secondes fractionnaires, un fuseau décalé, une chaîne invalide et `nil` (`StatusRulesTests.timeParsesIsoDates`).
- **Non appliqué (sûr mais exclu) :** ARCH-05, en conflit avec le correctif du crash « New task » en cours sur `fix/morax-code-new-task-crash`. Transmis à la session iOS, avec ARCH-01 à -07.
- **Non appliqués :** les autres constats, `safe_autofix: no` ou de sévérité basse (option « correctifs sûrs »). GLASS-01 relève de MoraxDesign.

Résultats :
- Build simulateur OK, avant comme après.
- `swift test` (MoraxWire) : 31 tests verts.
- Tests de l'app sur iPhone 18 Pro et iPad Pro 11" (M5) : verts à la relance. Le premier passage iPhone avait planté au lancement du simulateur (« Test crashed with signal kill before establishing connection »), sans lien avec le code.
- Leads du scanner : 7 avant, 6 après.
