import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { users, metasConfig, custosFixos, proLaboreRegras } from "@shared/schema";
import { REGRAS_PROLABORE_SEED } from "@shared/prolabore";
import { hojeBrasil } from "@shared/fluxo-utils";

async function upsertUser(username: string, nome: string, role: "admin" | "gestor") {
  const password = process.env.SEED_PASSWORD || "emanua123";
  const hash = await bcrypt.hash(password, 10);
  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing) {
    console.log(`user ${username} já existe`);
    return;
  }
  await db.insert(users).values({ username, nome, role, passwordHash: hash });
  console.log(`user ${username} criado (senha: ${password})`);
}

async function main() {
  await upsertUser("ataize", "Ataíze", "admin");
  await upsertUser("edson", "Edson", "gestor");

  const [meta] = await db.select().from(metasConfig).where(eq(metasConfig.chave, "global")).limit(1);
  if (!meta) {
    await db.insert(metasConfig).values({
      chave: "global",
      metaFaturamento: "25000",
      margemContribuicaoPct: "60",
    });
    console.log("meta global criada");
  }

  const fixos = await db.select().from(custosFixos).limit(1);
  if (fixos.length === 0) {
    const hoje = hojeBrasil();
    await db.insert(custosFixos).values([
      { descricao: "Aluguel da sala", categoria: "Aluguel", valorMensal: "1500", dataInicio: hoje },
      { descricao: "Energia elétrica", categoria: "Energia", valorMensal: "250", dataInicio: hoje },
      { descricao: "Internet", categoria: "Internet", valorMensal: "120", dataInicio: hoje },
      { descricao: "Contabilidade", categoria: "Contabilidade", valorMensal: "300", dataInicio: hoje },
    ]);
    console.log("custos fixos seed");
  }

  const regras = await db.select().from(proLaboreRegras).limit(1);
  if (regras.length === 0) {
    await db.insert(proLaboreRegras).values(
      REGRAS_PROLABORE_SEED.map((r) => ({ socio: r.socio, padrao: r.padrao, ordem: r.ordem })),
    );
    console.log("regras pró-labore seed");
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
