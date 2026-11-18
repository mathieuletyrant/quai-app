# AGENTS.md — règles pour les agents qui codent Quai

La spec produit est dans `docs/spec-v1.md`. Lis-la avant toute fonctionnalité.

## Structure

| Dossier | Rôle |
| --- | --- |
| `packages/api` | Le contrat : `HttpApi` + `Schema` d'Effect. Source de vérité des routes et des types. Génère `openapi.json`. |
| `apps/server` | Serveur Effect sur Node : implémente le contrat, écoute la stack, pousse vers APNs, sert la console. |
| `apps/console` | Console web React + Vite, client typé dérivé de `packages/api`. |
| `apps/ios` | App SwiftUI + extension widget (Live Activities). Projet XcodeGen (`project.yml`), client généré depuis `openapi.json`. |
| `Dockerfile` | La seule livraison serveur : une image générique. |

## Indépendance vis-à-vis de l'hôte

- Quai livre **une image Docker générique**. Aucun code, type ni route ne doit supposer Umbrel (ou un autre hôte).
- Le contrat (`packages/api`) ne parle que de Quai : services \*arr, activités, appareils. Jamais d'hôte.
- Toute la configuration passe par des variables d'environnement `QUAI_*` et le volume `/data`.
- Le manifeste Umbrel vit dans le dépôt `umbrel-community-app-store`, pas ici.

## Effect

- Version figée : `effect` et `@effect/*` en **4.1.4**, via le `catalog:` de `pnpm-workspace.yaml`. Ne jamais monter de version sans le demander : `effect/http`, `effect/http-api` et `effect/sql` sont « unstable ».
- Doc de référence : https://effect.website/llms.txt (v4). En cas de doute sur une signature, lire les `.d.ts` dans `node_modules/effect/dist/`.
- Un service = un `Context.Service` + un `Layer` (`static readonly layer`). Un `Layer` par service \*arr.
- Erreurs : `Data.TaggedError` (ou `Schema.TaggedErrorClass` si elles traversent l'API). Pas de `throw`.
- Pas de `Promise` nue ni de `async` côté serveur : tout est `Effect`. Les seules `Promise` tolérées sont à la frontière React de la console.
- Le temps passe par `Clock` (jamais `Date.now()` dans la logique) pour que `TestClock` fonctionne. Seule exception : l'heure de démarrage dans `ServerInfo.layer`.
- Dans un `HttpApiBuilder.group`, récupère les services dans l'`Effect.gen` extérieur, pas dans chaque handler.

## Tests

- **Pas de fonctionnalité fusionnée sans son test.**
- `@effect/vitest` (`it.effect`) ; avancer le temps avec `TestClock.adjust`, jamais d'attente réelle.
- Routes : `HttpApiTest.groups(QuaiApi, [...])` avec `NodeHttpServer.layerTest`.
- Adaptateurs \*arr : réponses réelles enregistrées (fixtures), jamais d'appel à la vraie stack.
- Contrat : `openapi.json` est vérifié par un test. Après une modif de `packages/api` : `pnpm gen:openapi` et commiter le fichier.

## Commandes

```bash
pnpm install
pnpm check        # tsc sur tous les paquets
pnpm test         # vitest sur tous les paquets
pnpm gen:openapi  # régénère packages/api/openapi.json
pnpm dev:server   # serveur sur :8787
pnpm dev:console  # console sur :5173 (proxy /api → :8787)
```

iOS (macOS) : `cd apps/ios && xcodegen generate && open Quai.xcodeproj`.

## Avant de terminer une tâche

`pnpm check && pnpm test` doivent passer. Si `packages/api` a changé, `openapi.json` est régénéré et commité.
