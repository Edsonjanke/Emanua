import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  boolean,
  integer,
  decimal,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type UserRole = "admin" | "gestor";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nome: text("nome").notNull(),
  role: text("role").notNull().$type<UserRole>().default("admin"),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, createdAt: true, passwordHash: true })
  .extend({ password: z.string().min(4) });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const bancoContas = pgTable(
  "banco_contas",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    nome: text("nome").notNull(),
    agencia: text("agencia").notNull(),
    conta: text("conta").notNull(),
    saldoInicialData: text("saldo_inicial_data"),
    saldoInicialValor: decimal("saldo_inicial_valor", { precision: 12, scale: 2 }),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idx_banco_contas_agencia_conta").on(t.agencia, t.conta)],
);
export type BancoConta = typeof bancoContas.$inferSelect;

export const bancoMovimentacoes = pgTable(
  "banco_movimentacoes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    contaId: varchar("conta_id")
      .notNull()
      .references(() => bancoContas.id, { onDelete: "restrict" }),
    data: text("data").notNull(),
    historico: text("historico").notNull(),
    documento: text("documento"),
    valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
    tipo: text("tipo").notNull().$type<"C" | "D">(),
    ocorrencia: integer("ocorrencia").notNull().default(1),
    dedupKey: text("dedup_key").notNull(),
    conciliadoTipo: text("conciliado_tipo").$type<"recebivel" | "ignorado" | null>(),
    conciliadoId: varchar("conciliado_id"),
    conciliadoAuto: boolean("conciliado_auto"),
    conciliadoEm: timestamp("conciliado_em"),
    importadoEm: timestamp("importado_em").defaultNow().notNull(),
    /** Override manual: nome do sócio ou "excluir" */
    prolaboreOverride: text("prolabore_override"),
    prolaboreComentario: text("prolabore_comentario"),
  },
  (t) => [
    uniqueIndex("idx_banco_mov_dedup").on(t.contaId, t.dedupKey),
    index("idx_banco_mov_conta_data").on(t.contaId, t.data),
  ],
);
export type BancoMovimentacao = typeof bancoMovimentacoes.$inferSelect;

export const contasPagar = pgTable(
  "contas_pagar",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    descricao: text("descricao").notNull(),
    valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
    dataVencimento: text("data_vencimento").notNull(),
    dataPagamento: text("data_pagamento"),
    status: text("status").notNull().default("pendente").$type<"pendente" | "pago" | "vencido">(),
    categoria: text("categoria"),
    observacoes: text("observacoes"),
    /** Chave estável da planilha — evita duplicar no reimport. */
    importDedupKey: text("import_dedup_key"),
    recorrencia: text("recorrencia").$type<"mensal" | null>(),
    /** Parcela atual (1-based) quando for compra parcelada. */
    parcelaAtual: integer("parcela_atual"),
    /** Total de parcelas do parcelamento. */
    totalParcelas: integer("total_parcelas"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_contas_pagar_vencimento").on(t.dataVencimento),
    uniqueIndex("idx_contas_pagar_import_dedup").on(t.importDedupKey),
  ],
);
export const insertContaPagarSchema = createInsertSchema(contasPagar).omit({
  id: true,
  createdAt: true,
});
export type InsertContaPagar = z.infer<typeof insertContaPagarSchema>;
export type ContaPagar = typeof contasPagar.$inferSelect;

/** Contas a receber slim (sem NF/boleto/CA). */
export const recebiveis = pgTable(
  "recebiveis",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    clienteNome: text("cliente_nome").notNull(),
    descricao: text("descricao"),
    valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
    dataVencimento: text("data_vencimento").notNull(),
    dataPagamento: text("data_pagamento"),
    valorPago: decimal("valor_pago", { precision: 12, scale: 2 }),
    status: text("status").notNull().default("aberta").$type<"aberta" | "paga" | "cancelada">(),
    observacoes: text("observacoes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_recebiveis_status").on(t.status),
    index("idx_recebiveis_vencimento").on(t.dataVencimento),
  ],
);
export const insertRecebivelSchema = createInsertSchema(recebiveis).omit({
  id: true,
  createdAt: true,
});
export type InsertRecebivel = z.infer<typeof insertRecebivelSchema>;
export type Recebivel = typeof recebiveis.$inferSelect;

/** Lançamento rápido de receita do dia (híbrido). */
export const receitasDia = pgTable(
  "receitas_dia",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    data: text("data").notNull(),
    valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
    forma: text("forma").notNull().$type<"dinheiro" | "pix" | "cartao">(),
    observacao: text("observacao"),
    /** Chave estável da planilha — evita duplicar no reimport. */
    importDedupKey: text("import_dedup_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_receitas_dia_data").on(t.data),
    uniqueIndex("idx_receitas_dia_import_dedup").on(t.importDedupKey),
  ],
);
export const insertReceitaDiaSchema = createInsertSchema(receitasDia).omit({
  id: true,
  createdAt: true,
});
export type InsertReceitaDia = z.infer<typeof insertReceitaDiaSchema>;
export type ReceitaDia = typeof receitasDia.$inferSelect;

export const custosFixos = pgTable("custos_fixos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  descricao: text("descricao").notNull(),
  categoria: text("categoria").notNull(),
  valorMensal: decimal("valor_mensal", { precision: 12, scale: 2 }).notNull().default("0"),
  ativo: boolean("ativo").notNull().default(true),
  dataInicio: text("data_inicio").notNull(),
  dataFim: text("data_fim"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertCustoFixoSchema = createInsertSchema(custosFixos).omit({
  id: true,
  createdAt: true,
});
export type InsertCustoFixo = z.infer<typeof insertCustoFixoSchema>;
export type CustoFixo = typeof custosFixos.$inferSelect;

/** Metas mensais (chave única = year-month ou global). */
export const metasConfig = pgTable("metas_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chave: text("chave").notNull().unique(), // "global" | "YYYY-MM"
  metaFaturamento: decimal("meta_faturamento", { precision: 12, scale: 2 }).notNull().default("0"),
  margemContribuicaoPct: decimal("margem_contribuicao_pct", { precision: 8, scale: 2 })
    .notNull()
    .default("60"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MetasConfig = typeof metasConfig.$inferSelect;

/** Sócio é texto livre (configurável). */
export const proLaboreRegras = pgTable(
  "pro_labore_regras",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    socio: text("socio").notNull(),
    padrao: text("padrao").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idx_prolabore_regras_socio_padrao").on(t.socio, t.padrao)],
);
export const insertProLaboreRegraSchema = createInsertSchema(proLaboreRegras).omit({
  id: true,
  createdAt: true,
});
export type InsertProLaboreRegra = z.infer<typeof insertProLaboreRegraSchema>;
export type ProLaboreRegra = typeof proLaboreRegras.$inferSelect;

/** Categorias financeiras compartilhadas (contas a pagar, custos fixos, fluxo). */
export const categorias = pgTable(
  "categorias",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    nome: text("nome").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idx_categorias_nome_lower").using("btree", sql`lower(${t.nome})`)],
);
export const insertCategoriaSchema = createInsertSchema(categorias).omit({
  id: true,
  createdAt: true,
});
export type InsertCategoria = z.infer<typeof insertCategoriaSchema>;
export type Categoria = typeof categorias.$inferSelect;

/** Seed / fallback — lista padrão histórica do app. */
export const CATEGORIAS_PAGAR = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet",
  "Insumos",
  "Roupas/Lençóis",
  "Marketing",
  "Contabilidade",
  "DAS",
  "Pessoal",
  "Pró-labore",
  "Outros",
] as const;
