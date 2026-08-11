# Emanua Financeiro — Design

App independente de controle financeiro para **Emanua Massoterapia**.

> Visual system (tokens, type, components, named rules): see root [`DESIGN.md`](../DESIGN.md) and [`.impeccable/design.json`](../.impeccable/design.json). This file keeps product/model decisions only.

## Decisões

- Stack: React 18 + Vite + Express + Drizzle + Postgres (Neon)
- Abas: Fluxo · Metas · DRE · Contas a Receber · Contas a Pagar · Pró-labore/Pessoal
- Receita híbrida: extrato bancário CSV + lançamento rápido “Receita do dia” (dinheiro / PIX / cartão)
- Sem Conta Azul, antecipação, OF/NF, agenda ou comissões no v1
- Referência visual/UX: Painel Financeiro do Evo SI (operate density); brand world is Light Sage Operate Shell (see root DESIGN.md)

## Modelo

- `banco_contas` / `banco_movimentacoes` — verdade do saldo bancário
- `receitas_dia` — faturamento operacional do dia
- `contas_pagar` / `recebiveis` — projeção do fluxo
- `custos_fixos` + `metas_config` — metas e ponto de equilíbrio
- `pro_labore_regras` — classificação de débitos pessoais (sócio texto livre)
