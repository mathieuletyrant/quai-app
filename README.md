# Quai

La couche iPhone et temps réel d'une stack média auto-hébergée : chaque film ou série suivi de la demande jusqu'au « prêt à regarder », en Live Activity.

- Spec produit : [`docs/spec-v1.md`](docs/spec-v1.md)
- Règles de développement : [`AGENTS.md`](AGENTS.md)

## Lancer

```bash
docker run -d --name quai -p 8787:8787 -v ./quai-data:/data ghcr.io/mathieuletyrant/quai:latest
```

Quai doit être sur le même réseau Docker que Radarr, Sonarr, etc. Voir `docker-compose.example.yml`.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `QUAI_PORT` | `8787` | Port HTTP (API + console) |
| `QUAI_DATA_DIR` | `/data` | Base SQLite et secrets chiffrés |
| `QUAI_CONSOLE_DIR` | `/app/console` | Console compilée servie par le serveur |

## Développer

```bash
pnpm install && pnpm test
```
