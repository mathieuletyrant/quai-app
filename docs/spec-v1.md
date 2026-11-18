# Quai — spécifications produit v1

Nov 18, 2026 · @Mathieu Le Tyrant

## Résumé

Quai est la couche iPhone et temps réel d'une stack média auto-hébergée : il suit chaque film ou série de la demande jusqu'au « prêt à regarder » sur l'écran verrouillé, et signale ce qui coince avec la correction en un appui.

Il se compose d'un serveur local, livré en image Docker générique et installé à côté des \*arr (chez moi : sur Umbrel, via mon store), et d'une app iOS native. Le serveur écoute la stack et pousse vers l'iPhone ; l'app affiche, et agit en un appui. Ni IA ni MCP en v1.

## Problème et positionnement

Les \*arr travaillent en silence : on ne sait pas qu'un film est prêt, qu'un import bloque ou qu'une suppression est prévue sans ouvrir cinq interfaces web. Le foyer, lui, demande des films sans savoir quand ils arrivent.

| Alternative | Ce qu'elle fait bien | Ce qu'elle ne peut pas faire |
| --- | --- | --- |
| Helmarr | Client iOS natif de toute la stack (bibliothèque, file, calendrier, widgets) | Rien quand l'app est fermée : pas de serveur, donc pas de push ni de Live Activity |
| Claude (ou un autre agent) + arr-mcp | Agir et expliquer en langage naturel | Être présent sur l'iPhone sans qu'on le lance, réagir en continu aux événements |
| Spotarr | Partage de liens, ajout automatique dans Seerr par règles | Le suivi après l'ajout |
| Companion app Home Assistant | Live Activities génériques | Comprendre le parcours d'un titre à travers la stack |

Quai ne refait pas le client de bibliothèque. Sa place : **le serveur qui veille, et l'iPhone qui montre et corrige**.

**Le foyer :**

| Personne | Rôle | Usage |
| --- | --- | --- |
| Mathieu | Admin | Installe, règle la console, reçoit tout, règle les problèmes |
| Julie | Membre | Pas de compte à elle : elle utilise le compte Jellyfin de Mathieu ; reçoit les Live Activities activées sur son iPhone |
| Tania | Invitée | Regarde sur Jellyfin, pas d'app Quai |

## Périmètre de la v1

La v1 ne livre que les Live Activities, avec le strict nécessaire autour : le serveur, l'installation, et une app iOS minimale pour se connecter et régler ses activités.

**Dans la v1**

- Serveur Quai : découverte des services, webhooks, interrogations, envoi des push à Apple
- Live Activities : téléchargement, lecture Jellyfin, sorties du jour, incident serveur
- App iOS : connexion au serveur, liste des activités en cours, réglages des Live Activities
- Console web : installation guidée, Live Activities, foyer, appareils, journal, réglages
- Services lus : Radarr, Sonarr, Prowlarr, Bazarr, qBittorrent, Seerr, Jellyfin
- Installation : image Docker générique, configurée par variables d'environnement ; l'app Umbrel n'est qu'un manifeste qui la référence, dans le dépôt du store

**Plus tard (v2 et suivantes)**

- À régler : règles fixes et corrections en un appui (avec Cleanuparr, Reclaimerr, Profilarr)
- Widgets, Siri et Raccourcis
- Accueil en tuiles, bibliothèque, recherche et ajout, fiche titre
- Live Activity « Demande à valider » (inutile tant que tout le foyer est en approbation automatique)

**Hors périmètre**

- Agent IA intégré et serveur MCP : un agent généraliste fait mieux, Quai n'apporte rien là
- Home Assistant et la maison
- Partage de liens et ajout par règles : c'est Spotarr ; ses ajouts passent par Seerr, donc Quai les suit sans intégration
- Lecture vidéo dans l'app, Android, Plex et Emby

## Live Activities

Quatre types en v1, tous démarrés à distance par le serveur (push-to-start), sans que l'app soit ouverte. Chacun a une bannière d'écran verrouillé et trois états de Dynamic Island (étendu, compact, minimal), comme sur les maquettes.

| Type | Démarre quand | Ce qu'elle montre | Se termine quand | Options |
| --- | --- | --- | --- | --- |
| Téléchargement | Un titre est ajouté dans Seerr, Radarr ou Sonarr (règles Spotarr comprises) | Étapes recherche, téléchargement (%, débit, reste), import, sous-titres FR, disponible | Disponible dans Jellyfin, puis reste affichée 15 min avec « Lire sur TV Salon » | Étapes affichées ; durée après la fin |
| Lecture Jellyfin | Une lecture démarre sur un appareil choisi | Titre, temps restant (minuteur natif), heure de fin | Fin de lecture ou 15 min sans lecture | Quels appareils Jellyfin |
| Sorties du jour | À l'heure choisie, s'il y a des sorties suivies | Liste du jour avec compte à rebours, puis coche quand récupéré | Tout est récupéré, ou minuit | Heure de départ ; séries choisies |
| Incident serveur | Un contrôle de santé échoue (service, indexeur, disque) | Service, depuis quand, recherches en attente | Retour à la normale : coche verte quelques minutes | Délai avant alerte (5 min par défaut) |

**Réglage à deux niveaux**

1. Console (admin) : chaque type activé ou non, ses déclencheurs, ses étapes, et qui peut le recevoir. Les destinataires sont des iPhone, pas des comptes : Julie partage le compte Jellyfin de Mathieu, donc Quai ne peut pas savoir qui a demandé quoi. Tania n'a pas d'app.
2. App (chaque personne) : un interrupteur par type et l'option propre au type. Un type coupé dans la console apparaît grisé dans l'app.

**Comportements communs**

- Un titre = une activité, même si plusieurs services en parlent : la clé est l'identifiant TMDB/TVDB, plus l'identifiant du torrent pendant le téléchargement.
- Plusieurs activités du même type en même temps : une par titre, dans la limite d'Apple ; au-delà, une activité groupée « 3 téléchargements ».
- Un téléchargement sans source depuis 2 h passe en gris avec « Autre release ».
- Un appui ouvre l'app sur la liste des activités ; le bouton de fin ouvre Jellyfin sur le titre.
- Les boutons (Lire, Autre release, Réessayer) s'exécutent sans ouvrir l'app, via App Intents.

## App iOS v1

L'app sert à trois choses en v1 : se relier au serveur, voir les activités en cours, régler ce qu'on reçoit. Elle ne remplace pas Jellyfin ni Seerr.

| Écran | Contenu | Maquette |
| --- | --- | --- |
| Connexion | Scan du QR code de la console, ou saisie de l'adresse ; connexion locale en Wi-Fi, sinon par l'adresse publique derrière Cloudflare Access ; autorisations Live Activities et notifications | App · Connexion au serveur |
| Activité | Activités en cours en tête, puis le fil des événements du jour (ajouts, grabs, imports, incidents) | App · Activité |
| Réglages | Serveur et connexion, Live Activities, notifications, couleur d'accent | App · Réglages |
| Réglages · Live Activities | Un interrupteur et une option par type ; types coupés par l'admin grisés | App · Réglages · Live Activities |

Navigation : deux onglets (Activité, Réglages) dans la barre flottante d'iOS. Sombre par défaut, couleur d'accent au choix.

## Service web

La console tourne sur le serveur Quai : c'est là que l'admin installe, branche les services et décide ce qui part vers les iPhone. Sans compte à créer : l'accès est protégé par l'hôte en local (proxy d'Umbrel chez moi) et par Cloudflare Access à distance.

**Installation guidée, en 4 étapes**

1. **Serveur** : Quai indique sur quel réseau Docker il tourne et ce qu'il y voit ; aucun hôte particulier n'est supposé.
2. **Services** : liste des services trouvés, avec leur adresse interne et leur clé API ; Quai pose lui-même ses webhooks dans Radarr, Sonarr, Prowlarr et Seerr.
3. **Accès hors de chez toi** : tunnel Cloudflare détecté (publication de `quai.cheztomy.cc` derrière Access), VPN, ou seulement à la maison.
4. **iPhone** : QR code à usage unique, valable 10 minutes ; un code par iPhone.

**Console**

| Page | Contenu |
| --- | --- |
| Vue d'ensemble | État des services, activités en cours, appareils, règles des Live Activities |
| Services | Version, adresse interne, ce que Quai reçoit (webhook ou interrogation), temps de réponse, disque |
| Live Activities | Par type : activé, déclencheurs, étapes affichées, iPhone destinataires, fin |
| Appareils | Chaque iPhone relié (nom, autorisations, activités en cours), test d'envoi, retrait, nouveau QR code |
| Journal | Webhooks reçus, push envoyés, actions, erreurs ; filtres et recherche |
| Réglages | Clé de push Apple, accès distant, apparence par défaut, sauvegarde, retrait de Quai |

La page Foyer des maquettes devient inutile en v1 : faute de comptes séparés, on raisonne par iPhone.

## Flux de données

Les changements d'étape arrivent par webhooks ; Quai n'interroge un service que lorsqu'une activité en a besoin, et lui seul envoie vers Apple.

&#91;embedded content: flux d'un événement · 5 sources, 3 étapes, 1 sortie vers Apple\]

Tout circule sur le réseau Docker interne de l'hôte : les services appellent Quai par son nom de conteneur. L'app et la console lisent le serveur directement, en local ou par `quai.cheztomy.cc`.

## Architecture technique

Un monorepo, un contrat d'API écrit une fois en Effect 4 : le serveur l'implémente, la console l'importe en TypeScript, l'app iOS le reçoit en client Swift généré depuis son OpenAPI. Effect convient, à condition de cadrer l'agent qui code.

&#91;embedded content: monorepo · un contrat, trois consommateurs\]

Changer une route dans `packages/api` casse la compilation du serveur, de la console et de l'app au même endroit : c'est le garde-fou principal d'un projet codé par agent.

| Brique | Choix | Pourquoi |
| --- | --- | --- |
| Contrat | `packages/api` : `HttpApi` + `Schema` d'Effect | Une seule définition des routes et des types ; OpenAPI généré pour Swift |
| Serveur | `apps/server` : Effect 4 sur Node (`@effect/platform-node`) | Erreurs typées, `Layer` pour chaque service \*arr, `Schedule` pour les interrogations et les relances |
| Base | SQLite (`@effect/sql-sqlite-node`), requêtes avec `SqlClient` d'Effect (`effect/sql`) | Un fichier, rien à installer ; pas d'ORM. `@effect/sql-kysely` n'existe pas en v4 (dernière version 0.48, pour Effect 3) |
| Push | Service Effect autour de `node:http2` + jeton JWT de la clé .p8 | APNs exige HTTP/2, que `fetch` de Node ne parle pas. Serveur APNs de développement pour les builds installés depuis Xcode, de production pour TestFlight : le serveur doit savoir lequel viser pour chaque iPhone |
| Console | `apps/console` : React + Vite, servie par le serveur | Client typé généré depuis `packages/api` |
| App iOS | `apps/ios` : SwiftUI, extension widget (Live Activities), App Intents | Projet décrit en YAML (XcodeGen ou Tuist) pour éviter les conflits du `.xcodeproj` |
| Client Swift | `swift-openapi-generator` sur l'OpenAPI du contrat | Pas de modèles Swift écrits à la main |
| Livraison | `Dockerfile` à la racine : une image générique (serveur + console) | Indépendante de l'hôte ; le manifeste Umbrel `mathieu-quai` vit dans `umbrel-community-app-store` et référence l'image |

**Cadrer le vibe coding avec Effect**

- Figer la version exacte d'Effect 4 : HTTP, HttpApi et SQL y sont des modules « unstable » qui peuvent changer entre deux versions mineures. Donner à l'agent la doc v4 : [effect.website/llms.txt](https://effect.website/llms.txt) et un skill Effect dans le repo.
- Un `AGENTS.md` qui fixe les motifs : un `Layer` par service, erreurs en `Data.TaggedError`, pas de `Promise` nue.
- Tests avec `@effect/vitest` sur des réponses enregistrées de Radarr, Sonarr et Seerr, pour rejouer un parcours sans toucher à la vraie stack.
- Côté iOS, un schéma Xcode qui démarre une Live Activity de démo, pour itérer sur l'UI sans serveur.

## Tests

Le cœur à protéger est le moteur d'activités : une suite d'événements doit toujours donner la même suite de push. Les tests sont le garde-fou d'un projet codé par agent : règle dans `AGENTS.md`, pas de fonctionnalité fusionnée sans son test.

| Niveau | Ce qu'on vérifie | Comment |
| --- | --- | --- |
| Contrat | Les schémas décodent et ré-encodent sans perte ; l'OpenAPI ne change pas sans le vouloir | `@effect/vitest`, instantané de `openapi.json` |
| Adaptateurs | Chaque webhook et chaque réponse d'API de Radarr, Sonarr, Prowlarr, Seerr, qBittorrent, Bazarr et Jellyfin est bien lu | Réponses réelles enregistrées (fixtures), une série par version de service |
| Moteur d'activités | Scénarios complets : ajout → grab → progression → import → disponible ; doublons fusionnés ; « sans source depuis 2 h » ; webhook manqué rattrapé | Scénarios rejoués avec le `TestClock` d'Effect pour avancer le temps sans attendre |
| Push | Bon environnement (développement ou production), bon type de push, au plus un envoi toutes les 15 s | Faux serveur APNs HTTP/2 local qui enregistre chaque envoi |
| Console | Installation guidée de bout en bout | Playwright contre des faux services |
| App iOS | Décodage des états ; rendu de chaque Live Activity (écran verrouillé, Dynamic Island étendue, compacte, minimale) | Swift Testing ; tests d'instantanés d'images sur des états types |

**Fixtures réelles.** Un script `record-fixtures` lit ta stack en lecture seule et enregistre les réponses, avec les clés et les noms de fichiers masqués. Quand un service change de version, on réenregistre et les écarts sautent aux yeux.

**Intégration continue.** Tests TypeScript sur chaque push ; build et tests iOS sur un runner macOS, seulement quand `apps/ios` ou `packages/api` change, pour limiter les minutes payantes.

## Exigences non fonctionnelles

- **Local d'abord.** Le serveur parle aux services par le réseau interne de la machine. Rien ne sort, sauf les push vers Apple et l'app quand on est dehors.
- **Aucun port à ouvrir.** Les webhooks arrivent en interne ; l'accès distant passe par le tunnel existant.
- **Secrets.** Clés API et clé de push stockées chiffrées sur le serveur, jamais renvoyées à l'app ni à la console en clair. L'app ne contient aucune clé de service.
- **Lecture seule par défaut.** En v1, Quai ne fait que deux écritures : poser et retirer ses webhooks. Les boutons d'action (autre release, réessayer) sont les seules autres.
- **Budget de push.** Mises à jour aux changements d'étape, et au plus une toutes les 15 s pendant un téléchargement ; le temps restant d'une lecture tourne côté iPhone.
- **Sobriété.** Interrogations uniquement quand une activité en a besoin ; objectif : moins de 100 Mo de mémoire et un CPU au repos quasi nul sur un N100.
- **Fiabilité.** Un webhook manqué est rattrapé par une lecture de l'état à la reconnexion ; un service muet ne bloque pas les autres.
- **Retrait propre.** Désinstaller Quai retire ses webhooks et délie les iPhone.

## Jalons

Le premier jalon qui compte est le n° 2 : une vraie Live Activity de téléchargement, de l'ajout à « prêt », sur ton iPhone.

1. **Prérequis Apple** : compte développeur, identifiant de l'app, clé de push (.p8). Terminé quand un push de test arrive sur l'iPhone.
2. **Téléchargement de bout en bout** : monorepo, serveur qui lit Radarr, Sonarr, qBittorrent et Jellyfin, app avec connexion par QR code, Live Activity Téléchargement. Terminé quand un ajout dans Seerr aboutit à « prêt » sans rien toucher.
3. **Les trois autres types** : lecture Jellyfin, incident serveur, sorties du jour.
4. **Console et réglages** : installation guidée complète, pages Live Activities, Appareils, Journal ; réglages côté app.
5. **Mise en service** : app dans ton store Umbrel (`mathieu-quai`), installation depuis Xcode sur ton iPhone et celui de Julie branchés en USB, puis TestFlight, deux semaines d'usage réel avant d'ouvrir la v2.

## Plus tard

Ces briques sont dessinées mais attendent la v2, dans cet ordre :

1. **À régler** : règles fixes (import bloqué, sans source, sans fichier après la sortie, sous-titres FR manquants, suppressions prévues par Cleanuparr ou Reclaimerr, disque bas), chacune avec sa correction en un appui.
2. **Widgets, Siri et Raccourcis** : écran d'accueil, écran verrouillé, StandBy ; « Ajoute Dune », « Qu'est-ce qui sort ce soir ? ».
3. **Accueil en tuiles, bibliothèque, recherche et ajout, fiche titre** avec le parcours du titre.

## Questions ouvertes

- [ ] **Nom** : Quai, Lanterne, Ouvreuse ? À vérifier sur l'App Store et en nom de domaine.
- [x] **Effect v4 retenu** : figé en 4.1.4. Pas d'intégration Kysely en v4 → requêtes avec le SQL d'Effect. HTTP et HttpApi sont dans `effect/http` et `effect/http-api`, toujours marqués « unstable ».
- [ ] **Découverte des services** : lire le socket Docker en lecture seule (accès sensible) ou tester les ports connus sur l'IP de la machine ?
- [ ] **Jellyfin** : plugin Webhook officiel ou interrogation des sessions ? L'interrogation évite un plugin à installer.
- [ ] **Sous-titres FR** : se fier à l'historique de Bazarr, ou lire les pistes du fichier dans Jellyfin ?
- [ ] **Limite d'activités simultanées** : à partir de combien de téléchargements regrouper en une seule activité ?
- [ ] **Distribution** : d'abord depuis Xcode en USB, puis TestFlight. App Store public : pas avant d'avoir vécu avec l'app.
