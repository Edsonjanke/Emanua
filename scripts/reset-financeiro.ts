/**
 * Zera dados financeiros (extrato, receitas, pagar/receber) para reimportar do zero.
 * Mantém: users, metas, custos fixos, regras de pró-labore.
 *
 * Uso: npx tsx --env-file=.env scripts/reset-financeiro.ts
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

async function main() {
  console.log("Limpando dados financeiros…");
  await db.execute(sql`
    TRUNCATE TABLE
      banco_movimentacoes,
      banco_contas,
      receitas_dia,
      contas_pagar,
      recebiveis
    RESTART IDENTITY CASCADE
  `);
  console.log("OK — extrato, contas, receitas, a pagar e a receber zerados.");
  console.log("Users / metas / custos fixos / pró-labore mantidos.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
