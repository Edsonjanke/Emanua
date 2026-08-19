import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Copie .env.example para .env");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
});

pool.on("connect", (client) => {
  client
    .query("SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000")
    .catch((err) => console.error("[db] timeouts:", err?.message));
});

pool.on("error", (err) => {
  console.error("[db] idle pool error (recovered):", err?.message);
});

export const db = drizzle(pool, { schema });

/** Colunas/índices de dedup da planilha — idempotente no boot. */
export async function ensureSchemaPatches() {
  await db.execute(sql`ALTER TABLE receitas_dia ADD COLUMN IF NOT EXISTS import_dedup_key text`);
  await db.execute(sql`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS import_dedup_key text`);
  // Parcelamento/recorrência — contas a pagar e a receber falam a mesma língua.
  await db.execute(sql`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS parcela_atual integer`);
  await db.execute(sql`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS total_parcelas integer`);
  await db.execute(sql`ALTER TABLE recebiveis ADD COLUMN IF NOT EXISTS recorrencia text`);
  await db.execute(sql`ALTER TABLE recebiveis ADD COLUMN IF NOT EXISTS parcela_atual integer`);
  await db.execute(sql`ALTER TABLE recebiveis ADD COLUMN IF NOT EXISTS total_parcelas integer`);
  // Índice único sem predicado: ON CONFLICT (col) exige isso no Postgres.
  // Vários NULL continuam permitidos.
  await db.execute(sql`DROP INDEX IF EXISTS idx_receitas_dia_import_dedup`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_receitas_dia_import_dedup
    ON receitas_dia (import_dedup_key)
  `);
  await db.execute(sql`DROP INDEX IF EXISTS idx_contas_pagar_import_dedup`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_pagar_import_dedup
    ON contas_pagar (import_dedup_key)
  `);
}
