# Emanua Financeiro

Controle financeiro da **Emanua Massoterapia** — fluxo de caixa, metas, DRE, contas a receber/pagar e pró-labore.

Stack: React 18 + Vite + Express + Drizzle + Postgres (Neon). Referência de UX: Painel Financeiro do Evo SI.

## Setup

```bash
cd C:\Users\Edson\projetos\Emanua-Financeiro
copy .env.example .env
# edite DATABASE_URL (Neon próprio, NÃO use o banco da Evo) e SESSION_SECRET
npm install
npm run db:init
npm run db:seed
npm run dev
```

Abra http://localhost:3002 — usuários seed: `ataize` / `edson` (senha em `SEED_PASSWORD`, default `emanua123`).

**Produção (Railway):** https://web-production-c03b9.up.railway.app  
Mesmo banco Neon `emanua_financeiro` e mesmos usuários.

## Scripts

| Comando | O quê |
|---------|--------|
| `npm run dev` | API + Vite HMR na porta `PORT` (3002) |
| `npm run db:init` | Cria tabelas (idempotente) |
| `npm run db:seed` | Usuários, metas, custos fixos, regras pró-labore |
| `npm test` | Vitest (extrato, conciliação, pró-labore, metas) |
| `npm run build` | Build do client em `dist/public` |

## Extrato CSV

Formato Viacredi (`;`):

```
agencia;?;conta;;
DD/MM/YYYY;Histórico;Documento;Valor;C|D
```

Na importação, preencha a **âncora** (data + saldo no fim daquele dia) para o gráfico de saldo real.

## Receita do dia

Lançamento rápido (dinheiro / PIX / cartão) sem detalhar sessão. Alimenta faturamento/metas. PIX/cartão entram no saldo bancário só via extrato.

## Abas

- **Fluxo** — KPIs, gráfico saldo real×projetado, timeline, import extrato
- **Metas** — meta de faturamento, PE, custos fixos
- **DRE** — gerencial mensal slim
- **A Receber / A Pagar** — CRUD + baixa (+ recorrência mensal no pagar)
- **Pró-labore** — regras configuráveis + classificação de débitos do extrato
