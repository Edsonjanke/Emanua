# Emanua Financeiro — Deploy Railway

Banco Neon (`emanua_financeiro`) já está na nuvem. Este guia cobre o servidor Express + frontend.

## Variáveis no Railway

```
NODE_ENV=production
DATABASE_URL=<pooled Neon, database emanua_financeiro, sa-east-1>
SESSION_SECRET=<mesmo do .env local, ou openssl rand -hex 32>
SEED_PASSWORD=emanua123
```

`PORT` é setado pelo Railway.

## Domínio

URL pública: **https://web-production-c03b9.up.railway.app**

Settings → Networking → Generate Domain (porta alvo **8080**).

**Repo ligado:** `Edsonjanke/Emanua` branch `main` — push em `main` dispara redeploy.

Redeploy manual: `npx @railway/cli up -y -c --service web`
