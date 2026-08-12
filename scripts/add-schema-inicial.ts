import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

async function main() {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      nome text NOT NULL,
      role text NOT NULL DEFAULT 'admin',
      ativo boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS banco_contas (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      nome text NOT NULL,
      agencia text NOT NULL,
      conta text NOT NULL,
      saldo_inicial_data text,
      saldo_inicial_valor decimal(12,2),
      ativo boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_banco_contas_agencia_conta ON banco_contas(agencia, conta)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS banco_movimentacoes (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      conta_id varchar NOT NULL REFERENCES banco_contas(id) ON DELETE RESTRICT,
      data text NOT NULL,
      historico text NOT NULL,
      documento text,
      valor decimal(12,2) NOT NULL,
      tipo text NOT NULL,
      ocorrencia integer NOT NULL DEFAULT 1,
      dedup_key text NOT NULL,
      conciliado_tipo text,
      conciliado_id varchar,
      conciliado_auto boolean,
      conciliado_em timestamp,
      importado_em timestamp NOT NULL DEFAULT now(),
      prolabore_override text,
      prolabore_comentario text
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_banco_mov_dedup ON banco_movimentacoes(conta_id, dedup_key)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_banco_mov_conta_data ON banco_movimentacoes(conta_id, data)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS contas_pagar (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      descricao text NOT NULL,
      valor decimal(12,2) NOT NULL,
      data_vencimento text NOT NULL,
      data_pagamento text,
      status text NOT NULL DEFAULT 'pendente',
      categoria text,
      observacoes text,
      import_dedup_key text,
      recorrencia text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_contas_pagar_vencimento ON contas_pagar(data_vencimento)`);
  await db.execute(sql`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS import_dedup_key text`);
  await db.execute(sql`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS parcela_atual integer`);
  await db.execute(sql`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS total_parcelas integer`);
  await db.execute(sql`DROP INDEX IF EXISTS idx_contas_pagar_import_dedup`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_pagar_import_dedup
    ON contas_pagar (import_dedup_key)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recebiveis (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_nome text NOT NULL,
      descricao text,
      valor decimal(12,2) NOT NULL,
      data_vencimento text NOT NULL,
      data_pagamento text,
      valor_pago decimal(12,2),
      status text NOT NULL DEFAULT 'aberta',
      observacoes text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_recebiveis_status ON recebiveis(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_recebiveis_vencimento ON recebiveis(data_vencimento)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS receitas_dia (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      data text NOT NULL,
      valor decimal(12,2) NOT NULL,
      forma text NOT NULL,
      observacao text,
      import_dedup_key text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_receitas_dia_data ON receitas_dia(data)`);
  await db.execute(sql`ALTER TABLE receitas_dia ADD COLUMN IF NOT EXISTS import_dedup_key text`);
  await db.execute(sql`DROP INDEX IF EXISTS idx_receitas_dia_import_dedup`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_receitas_dia_import_dedup
    ON receitas_dia (import_dedup_key)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS custos_fixos (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      descricao text NOT NULL,
      categoria text NOT NULL,
      valor_mensal decimal(12,2) NOT NULL DEFAULT 0,
      ativo boolean NOT NULL DEFAULT true,
      data_inicio text NOT NULL,
      data_fim text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS categorias (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      nome text NOT NULL,
      ativo boolean NOT NULL DEFAULT true,
      ordem integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_nome_lower
    ON categorias (lower(nome))
  `);
  await db.execute(sql`
    INSERT INTO categorias (nome, ordem, ativo)
    SELECT v.nome, v.ordem, true
    FROM (VALUES
      ('Aluguel', 1),
      ('Energia', 2),
      ('Água', 3),
      ('Internet', 4),
      ('Insumos', 5),
      ('Roupas/Lençóis', 6),
      ('Marketing', 7),
      ('Contabilidade', 8),
      ('DAS', 9),
      ('Pessoal', 10),
      ('Pró-labore', 11),
      ('Outros', 12)
    ) AS v(nome, ordem)
    WHERE NOT EXISTS (
      SELECT 1 FROM categorias c WHERE lower(c.nome) = lower(v.nome)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS metas_config (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      chave text NOT NULL UNIQUE,
      meta_faturamento decimal(12,2) NOT NULL DEFAULT 0,
      margem_contribuicao_pct decimal(8,2) NOT NULL DEFAULT 60,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pro_labore_regras (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      socio text NOT NULL,
      padrao text NOT NULL,
      ativo boolean NOT NULL DEFAULT true,
      ordem integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_prolabore_regras_socio_padrao ON pro_labore_regras(socio, padrao)`);

  console.log("Schema OK");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
