import type { Express, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./vite";
import {
  users,
  bancoContas,
  bancoMovimentacoes,
  contasPagar,
  recebiveis,
  receitasDia,
  custosFixos,
  metasConfig,
  proLaboreRegras,
  categorias,
} from "@shared/schema";
import {
  parseExtratoArquivo,
  buildDedupKey,
  saldoInicialDe,
  mensagemArquivoInvalido,
  type ExtratoRow,
} from "@shared/extrato-import";
import {
  classificarLinhas,
  periodoDe,
  totaisDe,
  type LancamentoVinculavel,
  type LinhaPreview,
  type MovExistente,
} from "@shared/extrato-diff";
import { parseGendoContasPagarCsv } from "@shared/contas-pagar-import";
import {
  datasParcelasMensais,
  normalizaTotalParcelas,
  proximoVencimentoMensal,
} from "@shared/parcelamento";
import { sugerirConciliacao } from "@shared/extrato-conciliacao";
import {
  validarIdentidadeConta,
  planejarContaAtiva,
  perguntaContaDiferente,
  type ContaIdentificada,
  type DecisaoContaAtiva,
  type MudancasFora,
} from "@shared/extrato-conta";
import { parseValorPositivo, parseValorPositivoOpcional } from "@shared/valor";
import { resolveDebitoNatureza } from "@shared/prolabore";
import {
  parsePlanilhaMovimentacoesBuffer,
  mapCategoriaPagar,
  inferFormaReceita,
  isReceitaOperacional,
  isTransferenciaInterna,
  inferSaldoInicialPlanilha,
  type PlanilhaMovRow,
} from "@shared/planilha-movimentacoes-import";
import {
  calcMinimoSobrevivencia,
  calcPontoEquilibrio,
  sumReceitasMes,
  roundMoney2,
} from "@shared/minimo-sobrevivencia";
import { hojeBrasil, addDias, round2, emptyDiaReal } from "@shared/fluxo-utils";

const extratoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const planilhaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Carrega do banco tudo que o diff do extrato precisa: movimentações já
 * importadas da mesma conta e lançamentos manuais candidatos a vínculo.
 * A classificação em si mora em @shared/extrato-diff (pura, testável).
 */
async function carregarContextoDiff(
  agencia: string,
  conta: string,
  rows: ExtratoRow[],
): Promise<{
  contaExistente: { id: string; nome: string } | null;
  existentes: MovExistente[];
  vinculaveis: LancamentoVinculavel[];
  de: string | null;
  ate: string | null;
}> {
  const { de, ate } = periodoDe(rows);
  const [bc] = await db
    .select()
    .from(bancoContas)
    .where(and(eq(bancoContas.agencia, agencia), eq(bancoContas.conta, conta)))
    .limit(1);

  const existentes: MovExistente[] = [];
  if (bc && de && ate) {
    // Janela folgada: uma transação corrigida pelo banco pode ter mudado de data.
    const movs = await db
      .select()
      .from(bancoMovimentacoes)
      .where(
        and(
          eq(bancoMovimentacoes.contaId, bc.id),
          gte(bancoMovimentacoes.data, addDias(de, -30)),
          lte(bancoMovimentacoes.data, addDias(ate, 30)),
        ),
      );
    for (const m of movs) {
      existentes.push({
        id: m.id,
        data: m.data,
        historico: m.historico,
        documento: m.documento,
        valor: Number(m.valor),
        tipo: m.tipo,
        dedupKey: m.dedupKey,
        ocorrencia: m.ocorrencia,
      });
    }
  }

  const vinculaveis: LancamentoVinculavel[] = [];
  if (de && ate) {
    const jDe = addDias(de, -7);
    const jAte = addDias(ate, 7);

    const cps = await db
      .select()
      .from(contasPagar)
      .where(and(gte(contasPagar.dataVencimento, jDe), lte(contasPagar.dataVencimento, jAte)));
    const cpsPagas = await db
      .select()
      .from(contasPagar)
      .where(and(gte(contasPagar.dataPagamento, jDe), lte(contasPagar.dataPagamento, jAte)));
    const cpVistos = new Set<string>();
    for (const c of [...cps, ...cpsPagas]) {
      if (cpVistos.has(c.id)) continue;
      cpVistos.add(c.id);
      vinculaveis.push({
        tipo: "conta_pagar",
        id: c.id,
        descricao: c.descricao,
        valor: Number(c.valor),
        data: c.dataPagamento || c.dataVencimento,
        fluxo: "D",
        status: c.status,
        dataPagamento: c.dataPagamento,
      });
    }

    const recs = await db
      .select()
      .from(receitasDia)
      .where(and(gte(receitasDia.data, jDe), lte(receitasDia.data, jAte)));
    for (const r of recs) {
      vinculaveis.push({
        tipo: "receita_dia",
        id: r.id,
        descricao: r.observacao || `Receita ${r.forma}`,
        valor: Number(r.valor),
        data: r.data,
        fluxo: "C",
      });
    }

    const rbs = await db
      .select()
      .from(recebiveis)
      .where(and(gte(recebiveis.dataVencimento, jDe), lte(recebiveis.dataVencimento, jAte)));
    for (const r of rbs) {
      vinculaveis.push({
        tipo: "recebivel",
        id: r.id,
        descricao: r.descricao || r.clienteNome,
        valor: Number(r.valorPago ?? r.valor),
        data: r.dataPagamento || r.dataVencimento,
        fluxo: "C",
        status: r.status,
        dataPagamento: r.dataPagamento,
      });
    }
  }

  return {
    contaExistente: bc ? { id: bc.id, nome: bc.nome } : null,
    existentes,
    vinculaveis,
    de,
    ate,
  };
}

function authorize(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Não autenticado" });
    if (roles.length && !roles.includes(req.session.role ?? "")) {
      return res.status(403).json({ message: "Sem permissão" });
    }
    next();
  };
}

export async function registerRoutes(app: Express) {
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/") || req.path === "/health") return next();
    return requireAuth(req, res, next);
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "emanua-financeiro" });
  });

  // ── Auth ──────────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ message: "Usuário e senha obrigatórios" });
    const [user] = await db.select().from(users).where(eq(users.username, String(username))).limit(1);
    if (!user || !user.ativo) return res.status(401).json({ message: "Credenciais inválidas" });
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Credenciais inválidas" });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.nome = user.nome;
    res.json({ id: user.id, username: user.username, nome: user.nome, role: user.role });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Não autenticado" });
    res.json({
      id: req.session.userId,
      username: req.session.username,
      nome: req.session.nome,
      role: req.session.role,
    });
  });

  // ── Extrato ───────────────────────────────────────────────────────────
  app.post("/api/extrato/parse-csv", authorize("admin", "gestor"), extratoUpload.single("file"), async (req: any, res) => {
    try {
      const texto = req.file?.buffer?.toString("utf-8") ?? "";
      const parsed = parseExtratoArquivo(texto, req.file?.originalname);
      res.json(parsed);
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Falha ao parsear extrato" });
    }
  });

  // Alias explícito (CSV ou OFX)
  app.post("/api/extrato/parse", authorize("admin", "gestor"), extratoUpload.single("file"), async (req: any, res) => {
    try {
      const texto = req.file?.buffer?.toString("utf-8") ?? "";
      const parsed = parseExtratoArquivo(texto, req.file?.originalname);
      res.json(parsed);
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Falha ao parsear extrato" });
    }
  });

  /**
   * Preview do import: parseia o arquivo e faz o DIFF contra o banco SEM ESCREVER NADA.
   * O extrato tem prioridade — aqui a gente só mostra onde ele discorda do que está gravado.
   */
  app.post(
    "/api/extrato/preview",
    authorize("admin", "gestor"),
    extratoUpload.single("file"),
    async (req: any, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: "Arquivo obrigatório (campo 'file')." });
        const texto = req.file.buffer.toString("utf-8");
        const parsed = parseExtratoArquivo(texto, req.file.originalname);
        if (!parsed.header) {
          return res.status(400).json({
            message: mensagemArquivoInvalido(req.file.originalname, texto, parsed.erros, parsed),
            erros: parsed.erros,
          });
        }

        /*
         * A identidade da conta é conferida JÁ NO PREVIEW: se ela veio de uma
         * linha que o leitor não entendeu (agência "2026-07-01"), o arquivo é
         * recusado aqui, antes de qualquer tela dizer que está tudo bem.
         */
        const identidade = validarIdentidadeConta(parsed.header.agencia, parsed.header.conta);
        if (!identidade.ok) {
          return res.status(400).json({ message: identidade.motivo, campo: identidade.campo });
        }

        const { agencia, conta } = parsed.header;
        const ctx = await carregarContextoDiff(agencia, conta, parsed.rows);
        const { linhas, resumo } = classificarLinhas({
          rows: parsed.rows,
          ignoradas: parsed.ignoradas ?? [],
          naoLidas: parsed.naoLidas ?? [],
          existentes: ctx.existentes,
          vinculaveis: ctx.vinculaveis,
        });

        /*
         * linhasLidas vem da FONTE — quantas linhas de dados o arquivo tem,
         * contadas pelo parser antes de qualquer filtro. Era
         * `rows.length + ignoradas.length`, ou seja, DEPOIS do descarte: o
         * balanco fechava por construcao e nao detectava linha nenhuma sumindo.
         */
        const linhasLidas = parsed.linhasArquivo;
        // Conta ativa HOJE: a tela precisa saber disso antes de gravar, para
        // perguntar em vez de trocar em silêncio quando o extrato é de outra.
        const [ativaAtual] = await db
          .select()
          .from(bancoContas)
          .where(eq(bancoContas.ativo, true))
          .orderBy(asc(bancoContas.createdAt))
          .limit(1);
        res.json({
          arquivo: {
            nome: req.file.originalname ?? "extrato",
            formato: parsed.formato ?? "viacredi",
            linhasLidas,
          },
          conta: {
            agencia,
            conta,
            nomeSugerido: ctx.contaExistente?.nome || parsed.titular || `Conta ${agencia}/${conta}`,
            titular: parsed.titular ?? null,
            existenteId: ctx.contaExistente?.id ?? null,
          },
          contaAtiva: ativaAtual
            ? {
                id: ativaAtual.id,
                nome: ativaAtual.nome,
                agencia: ativaAtual.agencia,
                conta: ativaAtual.conta,
                mesmaDoArquivo: ativaAtual.id === (ctx.contaExistente?.id ?? null),
              }
            : null,
          periodo: { de: ctx.de, ate: ctx.ate },
          saldoExtrato: parsed.saldoExtrato ?? null,
          // Saldo de abertura (linha SALDO ANTERIOR) — o preview usa para conferir
          // se creditos − debitos bate com saldoFinal − saldoInicial.
          saldoInicial: saldoInicialDe(parsed.ignoradas) ?? null,
          totais: totaisDe(parsed.rows),
          linhas,
          resumo,
          erros: parsed.erros,
          naoLidas: parsed.naoLidas,
        });
      } catch (e: any) {
        res.status(400).json({ message: e.message || "Falha ao gerar preview do extrato" });
      }
    },
  );

  app.post("/api/extrato/import", authorize("admin", "gestor"), async (req, res) => {
    try {
      const {
        agencia,
        conta,
        nome,
        rows,
        saldoInicialData,
        saldoInicialValor,
        ativar,
        formato,
        modo,
        selecionadas,
        aplicarVinculos,
        // Contagens do preview do MESMO arquivo, para o balanco do resultado
        // poder fechar contra o numero de linhas do ARQUIVO, e nao contra o
        // punhado de linhas que o cliente resolveu mandar.
        linhasLidas: linhasLidasBody,
        descartadas: descartadasBody,
        naoLidas: naoLidasBody,
        // Resposta do usuário quando o extrato é de uma conta diferente da ativa.
        decisaoContaAtiva,
      } = req.body ?? {};
      if (!agencia || !conta || !Array.isArray(rows)) {
        return res.status(400).json({ message: "agencia, conta e rows obrigatórios" });
      }

      /*
       * IDENTIDADE DA CONTA, ANTES DE QUALQUER ESCRITA.
       *
       * Sem esta porta, um arquivo cuja primeira linha foi lida como cabeçalho
       * criava a conta agência "2026-07-01" / conta "D900" — uma data e um
       * número de documento —, ativava essa conta e derrubava o saldo real do
       * painel. Recusar aqui é o que garante que arquivo torto não vira estado.
       */
      const identidade = validarIdentidadeConta(agencia, conta);
      if (!identidade.ok) {
        return res.status(400).json({ message: identidade.motivo, campo: identidade.campo });
      }

      const modoImport: "somente-novas" | "sobrescrever" =
        modo === "sobrescrever" ? "sobrescrever" : "somente-novas";
      const filtro: Set<string> | null = Array.isArray(selecionadas)
        ? new Set(selecionadas.map(String))
        : null;
      const selecionada = (dedupKey: string) => !filtro || filtro.has(dedupKey);

      let [bc] = await db
        .select()
        .from(bancoContas)
        .where(and(eq(bancoContas.agencia, String(agencia)), eq(bancoContas.conta, String(conta))))
        .limit(1);
      const [ativaAntes] = await db
        .select()
        .from(bancoContas)
        .where(eq(bancoContas.ativo, true))
        .orderBy(asc(bancoContas.createdAt))
        .limit(1);

      /*
       * QUEM FICA ATIVA — decisão do usuário, nunca efeito colateral do import.
       *
       * O código anterior fazia, sempre que `ativar !== false` (e o cliente
       * manda `true` em todo import): desativa todas as outras, ativa esta.
       * Qualquer arquivo roubava a conta ativa, e com ela o saldo real do
       * painel. Agora, extrato de outra conta PARA aqui e pergunta — antes de
       * criar conta, antes de gravar uma linha sequer.
       */
      const plano = planejarContaAtiva({
        ativaAtual: ativaAntes
          ? {
              id: ativaAntes.id,
              nome: ativaAntes.nome,
              agencia: ativaAntes.agencia,
              conta: ativaAntes.conta,
            }
          : null,
        alvo: bc
          ? { id: bc.id, nome: bc.nome, agencia: bc.agencia, conta: bc.conta }
          : null,
        extrato: {
          agencia: String(agencia),
          conta: String(conta),
          nome: String(nome || `Conta ${agencia}/${conta}`),
        },
        decisao: (decisaoContaAtiva ?? null) as DecisaoContaAtiva | null,
        ativar,
      });
      if (plano.acao === "perguntar") {
        return res.status(409).json({
          message: perguntaContaDiferente(plano),
          pergunta: {
            tipo: "conta-diferente",
            contaAtiva: plano.contaAtiva,
            contaExtrato: plano.contaExtrato,
            opcoes: [
              {
                id: "manter",
                rotulo: `Importar e manter ${plano.contaAtiva.nome} como conta ativa`,
              },
              {
                id: "trocar",
                rotulo: `Importar e ativar a conta do extrato (${plano.contaExtrato.nome})`,
              },
            ],
          },
        });
      }
      const ativarEstaConta = plano.acao === "ativar";

      const contaCriada = !bc;
      const nomeAntes = bc?.nome ?? null;
      const ancoraAnterior = bc
        ? {
            data: bc.saldoInicialData ?? null,
            valor: bc.saldoInicialValor != null ? Number(bc.saldoInicialValor) : null,
          }
        : null;

      if (!bc) {
        [bc] = await db
          .insert(bancoContas)
          .values({
            nome: nome || `Conta ${agencia}/${conta}`,
            agencia: String(agencia),
            conta: String(conta),
            ativo: ativarEstaConta,
            saldoInicialData: saldoInicialData || null,
            saldoInicialValor: saldoInicialValor != null ? String(saldoInicialValor) : null,
          })
          .returning();
      } else if (saldoInicialData != null || saldoInicialValor != null || ativarEstaConta) {
        await db
          .update(bancoContas)
          .set({
            ...(nome ? { nome: String(nome) } : {}),
            ...(ativarEstaConta ? { ativo: true } : {}),
            ...(saldoInicialData != null ? { saldoInicialData: String(saldoInicialData) } : {}),
            ...(saldoInicialValor != null ? { saldoInicialValor: String(saldoInicialValor) } : {}),
          })
          .where(eq(bancoContas.id, bc.id));
      }

      if (ativarEstaConta) {
        await db.update(bancoContas).set({ ativo: false }).where(ne(bancoContas.id, bc.id));
        await db.update(bancoContas).set({ ativo: true }).where(eq(bancoContas.id, bc.id));
      }

      /*
       * O QUE MUDOU FORA DAS LINHAS. A tela de resultado afirmava "Nenhum
       * lançamento que já estava no sistema foi alterado" com a conta ativa
       * trocada e o saldo do painel zerado — verdade sobre as linhas, mentira
       * sobre o sistema. Aqui sai a lista, e a tela é obrigada a mostrá-la.
       */
      const mudancas: MudancasFora = {
        contaCriada,
        contaAtivaTrocada: ativarEstaConta && (ativaAntes?.id ?? null) !== bc.id,
        contaAtivaAntes: ativaAntes ? { id: ativaAntes.id, nome: ativaAntes.nome } : null,
        contaAtivaAgora: ativarEstaConta
          ? { id: bc.id, nome: nome ? String(nome) : bc.nome }
          : ativaAntes
            ? { id: ativaAntes.id, nome: ativaAntes.nome }
            : null,
        // Só é MUDANÇA se mudou: regravar a mesma âncora com o mesmo valor não
        // vira item de lista, senão a lista do que mudou deixa de valer nada.
        ancoraGravada: (() => {
          if (saldoInicialData == null && saldoInicialValor == null) return null;
          const nova = {
            data: saldoInicialData != null ? String(saldoInicialData) : ancoraAnterior?.data ?? null,
            valor:
              saldoInicialValor != null
                ? Number(saldoInicialValor)
                : ancoraAnterior?.valor ?? null,
          };
          const igual =
            ancoraAnterior != null &&
            ancoraAnterior.data === nova.data &&
            ancoraAnterior.valor === nova.valor;
          return igual ? null : nova;
        })(),
        ancoraAnterior,
        nomeAlterado:
          nome && nomeAntes && String(nome) !== nomeAntes
            ? { de: nomeAntes, para: String(nome) }
            : null,
      };

      const BATCH = 100;

      // Diff contra o que já está no banco: separa novas × conflitos × duplicadas.
      const extratoRows = rows as ExtratoRow[];
      const ctx = await carregarContextoDiff(String(agencia), String(conta), extratoRows);
      const { linhas: classificadas } = classificarLinhas({
        rows: extratoRows,
        existentes: ctx.existentes,
        vinculaveis: aplicarVinculos ? ctx.vinculaveis : [],
      });
      const porDedup = new Map<string, LinhaPreview>();
      for (const l of classificadas) porDedup.set(l.dedupKey, l);

      // Conflito nunca vira linha nova: ou é sobrescrito, ou fica de fora.
      const aInserir = extratoRows.filter((r) => {
        const l = porDedup.get(r.dedupKey);
        if (!selecionada(r.dedupKey)) return false;
        return !l || l.situacao !== "conflito";
      });

      const values = aInserir.map((r: any) => ({
        contaId: bc.id,
        data: r.data,
        historico: r.historico,
        documento: r.documento ?? null,
        valor: String(r.valor),
        tipo: r.tipo,
        ocorrencia: r.ocorrencia ?? 1,
        dedupKey: r.dedupKey,
      }));

      let inseridas = 0;
      for (let i = 0; i < values.length; i += BATCH) {
        const chunk = values.slice(i, i + BATCH);
        try {
          const r = await db
            .insert(bancoMovimentacoes)
            .values(chunk)
            .onConflictDoNothing({
              target: [bancoMovimentacoes.contaId, bancoMovimentacoes.dedupKey],
            })
            .returning({ id: bancoMovimentacoes.id });
          inseridas += r.length;
        } catch {
          for (const row of chunk) {
            try {
              await db.insert(bancoMovimentacoes).values(row);
              inseridas++;
            } catch {
              /* duplicate */
            }
          }
        }
      }

      // Sobrescrita: o extrato manda. Corrige valor/data/histórico do que já estava gravado.
      let atualizadas = 0;
      if (modoImport === "sobrescrever") {
        for (const l of classificadas) {
          if (l.situacao !== "conflito" || !l.existente) continue;
          // Conflito que veio só do vínculo: a movimentação já está correta,
          // reescrevê-la seria um UPDATE no-op contado como "atualizada".
          if ((l.diffs?.length ?? 0) === 0) continue;
          if (!selecionada(l.dedupKey)) continue;
          const novaChave = buildDedupKey(
            l.data!,
            l.historico,
            l.documento,
            l.valor!,
            l.tipo!,
            l.ocorrencia ?? 1,
          );
          try {
            await db
              .update(bancoMovimentacoes)
              .set({
                data: l.data!,
                historico: l.historico,
                documento: l.documento,
                valor: String(l.valor),
                tipo: l.tipo!,
                dedupKey: novaChave,
              })
              .where(eq(bancoMovimentacoes.id, l.existente.id));
            atualizadas++;
          } catch {
            /* colisão de dedupKey: a linha correta já existe, nada a fazer */
          }
        }
      }

      // Vínculos: o extrato mostrando que a fonte manual (conta a pagar / receita) está errada.
      let vinculosAtualizados = 0;
      if (aplicarVinculos) {
        for (const l of classificadas) {
          const v = l.vinculo;
          if (!v || v.diffs.length === 0) continue;
          if (!selecionada(l.dedupKey)) continue;
          try {
            if (v.tipo === "conta_pagar") {
              await db
                .update(contasPagar)
                .set({ valor: String(l.valor), dataPagamento: l.data!, status: "pago" })
                .where(eq(contasPagar.id, v.id));
            } else if (v.tipo === "receita_dia") {
              await db
                .update(receitasDia)
                .set({ valor: String(l.valor), data: l.data! })
                .where(eq(receitasDia.id, v.id));
            } else {
              await db
                .update(recebiveis)
                .set({ valorPago: String(l.valor), dataPagamento: l.data!, status: "paga" })
                .where(eq(recebiveis.id, v.id));
            }
            vinculosAtualizados++;
          } catch {
            /* vínculo já removido/alterado por outra rota */
          }
        }
      }

      // Gendo: também alimenta receitas do dia e contas pagas (timeline + faturamento).
      let receitasInseridas = 0;
      let despesasInseridas = 0;
      if (formato === "gendo-transacoes" || rows.some((r: any) => r.syncReceita || r.syncDespesa)) {
        const existingRec = await db
          .select({ importDedupKey: receitasDia.importDedupKey })
          .from(receitasDia);
        const existingCp = await db
          .select({ importDedupKey: contasPagar.importDedupKey })
          .from(contasPagar);
        const recKeys = new Set(existingRec.map((x) => x.importDedupKey).filter(Boolean));
        const cpKeys = new Set(existingCp.map((x) => x.importDedupKey).filter(Boolean));

        const receitaValues: {
          data: string;
          valor: string;
          forma: "dinheiro" | "pix" | "cartao";
          observacao: string | null;
          importDedupKey: string;
        }[] = [];
        const despesaValues: {
          descricao: string;
          valor: string;
          dataVencimento: string;
          dataPagamento: string;
          status: "pago";
          categoria: string;
          observacoes: string;
          importDedupKey: string;
        }[] = [];

        for (const r of rows as any[]) {
          const key = `gendo:${r.dedupKey}`;
          if (r.syncReceita && r.tipo === "C") {
            if (recKeys.has(key)) continue;
            receitaValues.push({
              data: r.data,
              valor: String(r.valor),
              forma: r.forma || "dinheiro",
              observacao: [r.descricao || r.historico, r.documento].filter(Boolean).join(" · ").slice(0, 500),
              importDedupKey: key,
            });
            recKeys.add(key);
          }
          if (r.syncDespesa && r.tipo === "D") {
            if (cpKeys.has(key)) continue;
            const desc = String(r.descricao || r.historico || "Despesa").slice(0, 200);
            despesaValues.push({
              descricao: desc,
              valor: String(r.valor),
              dataVencimento: r.data,
              dataPagamento: r.data,
              status: "pago",
              categoria: mapCategoriaPagar(r.categoria ?? null),
              observacoes: [r.categoria, r.documento].filter(Boolean).join(" · ").slice(0, 500),
              importDedupKey: key,
            });
            cpKeys.add(key);
          }
        }

        for (let i = 0; i < receitaValues.length; i += BATCH) {
          const chunk = receitaValues.slice(i, i + BATCH);
          try {
            const ins = await db.insert(receitasDia).values(chunk).returning({ id: receitasDia.id });
            receitasInseridas += ins.length;
          } catch {
            for (const row of chunk) {
              try {
                await db.insert(receitasDia).values(row);
                receitasInseridas++;
              } catch {
                /* dup */
              }
            }
          }
        }
        for (let i = 0; i < despesaValues.length; i += BATCH) {
          const chunk = despesaValues.slice(i, i + BATCH);
          try {
            const ins = await db.insert(contasPagar).values(chunk).returning({ id: contasPagar.id });
            despesasInseridas += ins.length;
          } catch {
            for (const row of chunk) {
              try {
                await db.insert(contasPagar).values(row);
                despesasInseridas++;
              } catch {
                /* dup */
              }
            }
          }
        }
      }

      /*
       * BALANCO DO RESULTADO — os numeros que o servidor REALMENTE produziu.
       *
       * Antes o cliente reconstruia isso sozinho a partir da classificacao do
       * preview (`inseridas = min(inseridas, novas)`, `foraDaSelecao = novas -
       * inseridas`, ...), o que colapsa algebricamente no balanco do preview e
       * fecha sempre, tenha o import gravado o que tiver gravado. Aqui cada
       * categoria sai de um fato: `inseridas`/`atualizadas` vem do banco,
       * o resto da classificacao das linhas que o cliente mandou.
       */
      let cNovas = 0;
      let cDuplicadas = 0;
      let cConflitos = 0;
      let novasSelecionadas = 0;
      for (const l of classificadas) {
        if (l.situacao === "nova") {
          cNovas++;
          if (selecionada(l.dedupKey)) novasSelecionadas++;
        } else if (l.situacao === "duplicada") cDuplicadas++;
        else if (l.situacao === "conflito") cConflitos++;
      }
      const foraDaSelecao = cNovas - novasSelecionadas;
      // Marcada para inserir mas o INSERT nao criou linha: ja estava gravada.
      const colisoes = novasSelecionadas - inseridas;
      const jaNoSistema = cDuplicadas + colisoes + (cConflitos - atualizadas);

      const inteiro = (v: unknown, padrao: number): number => {
        const n = Math.trunc(Number(v));
        return Number.isFinite(n) && n >= 0 ? n : padrao;
      };
      const descartadas = inteiro(descartadasBody, 0);
      const naoLidasCount = inteiro(naoLidasBody, 0);
      // Sem o numero do arquivo, o balanco so pode falar do que recebeu.
      const linhasDoArquivo = inteiro(
        linhasLidasBody,
        extratoRows.length + descartadas + naoLidasCount,
      );

      res.json({
        contaId: bc.id,
        inseridas,
        total: rows.length,
        receitasInseridas,
        despesasInseridas,
        modo: modoImport,
        atualizadas,
        vinculosAtualizados,
        conta: { id: bc.id, nome: nome ? String(nome) : bc.nome },
        mudancas,
        balanco: {
          linhasLidas: linhasDoArquivo,
          linhasRecebidas: extratoRows.length,
          inseridas,
          regravadas: atualizadas,
          jaNoSistema,
          foraDaSelecao,
          descartadas,
          naoLidas: naoLidasCount,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/extrato/status", authorize("admin", "gestor"), async (_req, res) => {
    const [conta] = await db
      .select()
      .from(bancoContas)
      .where(eq(bancoContas.ativo, true))
      .orderBy(asc(bancoContas.createdAt))
      .limit(1);
    if (!conta) return res.json({ conta: null, ultimaData: null, totalMovs: 0 });
    const movs = await db
      .select({ data: bancoMovimentacoes.data })
      .from(bancoMovimentacoes)
      .where(eq(bancoMovimentacoes.contaId, conta.id));
    const ultimaData = movs.reduce<string | null>((a, m) => (!a || m.data > a ? m.data : a), null);
    res.json({ conta, ultimaData, totalMovs: movs.length });
  });

  app.get("/api/extrato", authorize("admin", "gestor"), async (req, res) => {
    const de = String(req.query.de ?? "");
    const ate = String(req.query.ate ?? "");
    const [conta] = await db
      .select()
      .from(bancoContas)
      .where(eq(bancoContas.ativo, true))
      .orderBy(asc(bancoContas.createdAt))
      .limit(1);
    if (!conta) return res.json([]);
    const conds = [eq(bancoMovimentacoes.contaId, conta.id)];
    if (/^\d{4}-\d{2}-\d{2}$/.test(de)) conds.push(gte(bancoMovimentacoes.data, de));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) conds.push(lte(bancoMovimentacoes.data, ate));
    const rows = await db
      .select()
      .from(bancoMovimentacoes)
      .where(and(...conds))
      .orderBy(desc(bancoMovimentacoes.data));
    res.json(rows);
  });

  app.post("/api/extrato/reconciliar", authorize("admin", "gestor"), async (_req, res) => {
    const [conta] = await db.select().from(bancoContas).where(eq(bancoContas.ativo, true)).limit(1);
    if (!conta) return res.json({ matches: 0 });
    const movs = await db.select().from(bancoMovimentacoes).where(eq(bancoMovimentacoes.contaId, conta.id));
    const recs = await db.select().from(recebiveis).where(eq(recebiveis.status, "aberta"));
    const sugestoes = sugerirConciliacao(
      movs.map((m) => ({
        id: m.id,
        data: m.data,
        valor: Number(m.valor),
        tipo: m.tipo,
        conciliadoTipo: m.conciliadoTipo,
      })),
      recs.map((r) => ({
        id: r.id,
        valor: Number(r.valor),
        dataVencimento: r.dataVencimento,
        status: r.status,
      })),
    );
    let matches = 0;
    for (const s of sugestoes) {
      await db
        .update(bancoMovimentacoes)
        .set({
          conciliadoTipo: "recebivel",
          conciliadoId: s.recebivelId,
          conciliadoAuto: true,
          conciliadoEm: new Date(),
        })
        .where(eq(bancoMovimentacoes.id, s.movId));
      await db
        .update(recebiveis)
        .set({
          status: "paga",
          dataPagamento: movs.find((m) => m.id === s.movId)?.data ?? hojeBrasil(),
          valorPago: String(recs.find((r) => r.id === s.recebivelId)?.valor ?? 0),
        })
        .where(eq(recebiveis.id, s.recebivelId));
      matches++;
    }
    res.json({ matches, sugestoes: sugestoes.length });
  });

  app.patch("/api/extrato/:id/prolabore", authorize("admin", "gestor"), async (req, res) => {
    const { override, comentario } = req.body ?? {};
    const [row] = await db
      .update(bancoMovimentacoes)
      .set({
        ...(override !== undefined ? { prolaboreOverride: override } : {}),
        ...(comentario !== undefined ? { prolaboreComentario: comentario } : {}),
      })
      .where(eq(bancoMovimentacoes.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ message: "Não encontrado" });
    res.json(row);
  });

  // ── Planilha entradas/saídas (XLSX) ──────────────────────────────────
  app.post(
    "/api/planilha/parse",
    authorize("admin", "gestor"),
    planilhaUpload.single("file"),
    async (req: any, res) => {
      try {
        if (!req.file?.buffer) return res.status(400).json({ message: "Arquivo obrigatório" });
        const parsed = parsePlanilhaMovimentacoesBuffer(req.file.buffer);
        const saldoInicial = inferSaldoInicialPlanilha(parsed.rows);
        res.json({
          ...parsed,
          preview: parsed.rows.slice(0, 30),
          saldoInicial,
        });
      } catch (e: any) {
        res.status(400).json({ message: e.message || "Falha ao ler planilha" });
      }
    },
  );

  app.post("/api/planilha/import", authorize("admin", "gestor"), async (req, res) => {
    try {
      const rows = (req.body?.rows ?? []) as PlanilhaMovRow[];
      const opts = {
        extrato: req.body?.extrato !== false,
        receitas: req.body?.receitas !== false,
        despesas: req.body?.despesas !== false,
        skipTransferenciasInternas: req.body?.skipTransferenciasInternas !== false,
      };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows obrigatório" });
      }

      const result = {
        extratoInseridos: 0,
        extratoDuplicados: 0,
        receitasInseridas: 0,
        receitasDuplicadas: 0,
        despesasInseridas: 0,
        despesasDuplicadas: 0,
        contasCriadas: [] as string[],
        /*
         * O que mudou FORA das linhas. Importar planilha trocava a conta ativa
         * em silêncio e o resultado só falava de linhas inseridas — a mesma
         * mentira por omissão que o import de extrato já tinha consertado.
         */
        contaAtivaTrocada: false,
        contaAtivaAntes: null as string | null,
        contaAtivaAgora: null as string | null,
      };

      const BATCH = 100;
      function chunks<T>(arr: T[]): T[][] {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += BATCH) out.push(arr.slice(i, i + BATCH));
        return out;
      }

      // Uma conta consolidada: o Fluxo lê a conta ativa; a origem fica no histórico.
      let contaId: string | null = null;
      if (opts.extrato) {
        const consolidado = "Planilha consolidada";
        const slug = "planilha-consolidada";
        const inferred = inferSaldoInicialPlanilha(rows);
        const datas = rows.map((r) => r.data).sort();
        const primeira = datas[0];
        let ancoraData = inferred.data;
        if (!ancoraData && primeira) {
          const d = new Date(primeira + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() - 1);
          ancoraData = d.toISOString().slice(0, 10);
        }
        const ancoraValor =
          inferred.valor != null ? String(inferred.valor) : req.body?.saldoInicialValor != null
            ? String(req.body.saldoInicialValor)
            : "0";

        /*
         * IDENTIDADE ANTES DE QUALQUER ESCRITA — o irmão do que o import de
         * extrato já faz. Aqui a identidade é constante, e por isso mesmo a
         * porta é barata: se um dia alguém passar a tirar "agencia"/"conta" do
         * arquivo, ela já está no caminho e um arquivo torto não vira conta.
         */
        const identidade = validarIdentidadeConta("planilha", slug);
        if (!identidade.ok) {
          return res.status(400).json({ message: identidade.motivo, campo: identidade.campo });
        }

        const [existing] = await db
          .select()
          .from(bancoContas)
          .where(
            and(
              eq(bancoContas.agencia, identidade.agencia),
              eq(bancoContas.conta, identidade.conta),
            ),
          )
          .limit(1);
        const [ativaAntes] = await db
          .select()
          .from(bancoContas)
          .where(eq(bancoContas.ativo, true))
          .orderBy(asc(bancoContas.createdAt))
          .limit(1);

        /*
         * QUEM FICA ATIVA — decisão do usuário, nunca efeito colateral.
         *
         * Este trecho fazia, SEMPRE: `SET ativo=false WHERE id <> contaId`
         * seguido de `SET ativo=true WHERE id = contaId`. Era o irmão exato do
         * defeito já consertado no import de extrato: importar uma planilha
         * roubava a conta ativa — e com ela o saldo real do painel — sem
         * perguntar nada e sem dizer nada depois. O Fluxo lê a conta ativa, e
         * de repente o saldo era o da planilha, não o do banco.
         *
         * Agora vale a mesma regra do extrato: só troca quando não há nada a
         * perder (primeira conta), quando não há troca nenhuma (a consolidada
         * já era a ativa) ou quando o usuário respondeu que quer trocar.
         */
        const plano = planejarContaAtiva({
          ativaAtual: ativaAntes
            ? {
                id: ativaAntes.id,
                nome: ativaAntes.nome,
                agencia: ativaAntes.agencia,
                conta: ativaAntes.conta,
              }
            : null,
          alvo: existing
            ? {
                id: existing.id,
                nome: existing.nome,
                agencia: existing.agencia,
                conta: existing.conta,
              }
            : null,
          extrato: { agencia: identidade.agencia, conta: identidade.conta, nome: consolidado },
          decisao: (req.body?.decisaoContaAtiva ?? null) as DecisaoContaAtiva | null,
          ativar: req.body?.ativarConta,
        });
        if (plano.acao === "perguntar") {
          // Nada foi gravado: é pergunta, não falha. Mesmo contrato do extrato.
          return res.status(409).json({
            message: perguntaContaDiferente(plano),
            pergunta: {
              tipo: "conta-diferente",
              contaAtiva: plano.contaAtiva,
              contaExtrato: plano.contaExtrato,
              opcoes: [
                {
                  id: "manter",
                  rotulo: `Importar e manter ${plano.contaAtiva.nome} como conta ativa`,
                },
                {
                  id: "trocar",
                  rotulo: `Importar e ativar a ${plano.contaExtrato.nome}`,
                },
              ],
            },
          });
        }
        const ativarEstaConta = plano.acao === "ativar";

        if (existing) {
          contaId = existing.id;
          await db
            .update(bancoContas)
            .set({
              ...(ativarEstaConta ? { ativo: true } : {}),
              saldoInicialData: ancoraData,
              saldoInicialValor: ancoraValor,
            })
            .where(eq(bancoContas.id, contaId));
        } else {
          const [created] = await db
            .insert(bancoContas)
            .values({
              nome: consolidado,
              agencia: identidade.agencia,
              conta: identidade.conta,
              ativo: ativarEstaConta,
              saldoInicialData: ancoraData,
              saldoInicialValor: ancoraValor,
            })
            .returning();
          result.contasCriadas.push(consolidado);
          contaId = created.id;
        }
        // Fluxo usa a 1ª conta ativa. Só desativa as outras quando a troca foi
        // autorizada — antes isto rodava em todo import, incondicionalmente.
        if (ativarEstaConta) {
          await db.update(bancoContas).set({ ativo: false }).where(ne(bancoContas.id, contaId));
          await db.update(bancoContas).set({ ativo: true }).where(eq(bancoContas.id, contaId));
        }
        result.contaAtivaTrocada = ativarEstaConta && (ativaAntes?.id ?? null) !== contaId;
        result.contaAtivaAntes = ativaAntes?.nome ?? null;
        result.contaAtivaAgora = ativarEstaConta ? consolidado : (ativaAntes?.nome ?? null);

        // Reimport: remove transferências internas que tenham entrado antes.
        if (opts.skipTransferenciasInternas) {
          const transferKeys = rows
            .filter((r) => isTransferenciaInterna(r.categoria))
            .map((r) => r.dedupKey);
          if (transferKeys.length) {
            for (let i = 0; i < transferKeys.length; i += BATCH) {
              const chunk = transferKeys.slice(i, i + BATCH);
              await db
                .delete(bancoMovimentacoes)
                .where(
                  and(eq(bancoMovimentacoes.contaId, contaId), inArray(bancoMovimentacoes.dedupKey, chunk)),
                );
            }
          }
        }
      }

      const [receitasExist, cpsExist, movsExist] = await Promise.all([
        opts.receitas
          ? db
              .select({
                id: receitasDia.id,
                data: receitasDia.data,
                valor: receitasDia.valor,
                observacao: receitasDia.observacao,
                importDedupKey: receitasDia.importDedupKey,
              })
              .from(receitasDia)
          : Promise.resolve([]),
        opts.despesas
          ? db
              .select({
                id: contasPagar.id,
                dataVencimento: contasPagar.dataVencimento,
                valor: contasPagar.valor,
                descricao: contasPagar.descricao,
                importDedupKey: contasPagar.importDedupKey,
              })
              .from(contasPagar)
          : Promise.resolve([]),
        opts.extrato && contaId
          ? db
              .select({ dedupKey: bancoMovimentacoes.dedupKey })
              .from(bancoMovimentacoes)
              .where(eq(bancoMovimentacoes.contaId, contaId))
          : Promise.resolve([]),
      ]);

      const receitaByDedup = new Set(
        receitasExist.map((r) => r.importDedupKey).filter((k): k is string => !!k),
      );
      const receitaBySoft = new Map<string, string>(); // softKey → id (só sem dedup ainda)
      for (const r of receitasExist) {
        const soft = `${r.data}|${Number(r.valor).toFixed(2)}|${(r.observacao ?? "").slice(0, 120)}`;
        if (!r.importDedupKey) receitaBySoft.set(soft, r.id);
      }

      const cpByDedup = new Set(
        cpsExist.map((c) => c.importDedupKey).filter((k): k is string => !!k),
      );
      const cpBySoft = new Map<string, string>();
      for (const c of cpsExist) {
        const soft = `${c.dataVencimento}|${Number(c.valor).toFixed(2)}|${c.descricao}`;
        if (!c.importDedupKey) cpBySoft.set(soft, c.id);
      }

      const movKeys = new Set(movsExist.map((m) => m.dedupKey));

      const movValues: {
        contaId: string;
        data: string;
        historico: string;
        documento: string | null;
        valor: string;
        tipo: "C" | "D";
        ocorrencia: number;
        dedupKey: string;
        prolaboreComentario: string | null;
        prolaboreOverride?: string;
      }[] = [];
      const receitaValues: {
        data: string;
        valor: string;
        forma: "dinheiro" | "pix" | "cartao";
        observacao: string | null;
        importDedupKey: string;
      }[] = [];
      const despesaValues: {
        descricao: string;
        valor: string;
        dataVencimento: string;
        dataPagamento: string;
        status: "pago";
        categoria: string;
        observacoes: string;
        importDedupKey: string;
      }[] = [];
      const receitaBackfill: { id: string; key: string }[] = [];
      const cpBackfill: { id: string; key: string }[] = [];

      for (const row of rows) {
        if (!row.dedupKey) continue;
        const skipInterna = opts.skipTransferenciasInternas && isTransferenciaInterna(row.categoria);

        if (opts.extrato && contaId) {
          // Em conta consolidada, transferência interna distorce o saldo (não se anula).
          if (skipInterna) {
            // ignorada de propósito
          } else if (movKeys.has(row.dedupKey)) {
            result.extratoDuplicados++;
          } else {
            const valor = row.tipo === "Entrada" ? row.entrada : row.saida;
            const tipo = row.tipo === "Entrada" ? ("C" as const) : ("D" as const);
            movValues.push({
              contaId,
              data: row.data,
              historico: `[${row.conta}] ${row.descricao}`.toUpperCase().slice(0, 500),
              documento: row.fonte,
              valor: String(valor),
              tipo,
              ocorrencia: 1,
              dedupKey: row.dedupKey,
              prolaboreComentario: row.observacao,
            });
            movKeys.add(row.dedupKey);
          }
        }

        if (opts.receitas && row.tipo === "Entrada" && isReceitaOperacional(row.categoria) && !skipInterna) {
          const forma = inferFormaReceita(row.conta, row.descricao);
          const obs = [row.descricao, row.subcategoria, row.observacao].filter(Boolean).join(" · ").slice(0, 500);
          const soft = `${row.data}|${row.entrada.toFixed(2)}|${obs.slice(0, 120)}`;

          if (receitaByDedup.has(row.dedupKey)) {
            result.receitasDuplicadas++;
          } else if (receitaBySoft.has(soft)) {
            result.receitasDuplicadas++;
            receitaBackfill.push({ id: receitaBySoft.get(soft)!, key: row.dedupKey });
            receitaBySoft.delete(soft);
            receitaByDedup.add(row.dedupKey);
          } else {
            receitaValues.push({
              data: row.data,
              valor: String(row.entrada),
              forma,
              observacao: obs || null,
              importDedupKey: row.dedupKey,
            });
            receitaByDedup.add(row.dedupKey);
          }
        }

        if (opts.despesas && row.tipo === "Saida" && !skipInterna) {
          const desc = row.descricao.slice(0, 200);
          const soft = `${row.data}|${row.saida.toFixed(2)}|${desc}`;

          if (cpByDedup.has(row.dedupKey)) {
            result.despesasDuplicadas++;
          } else if (cpBySoft.has(soft)) {
            result.despesasDuplicadas++;
            cpBackfill.push({ id: cpBySoft.get(soft)!, key: row.dedupKey });
            cpBySoft.delete(soft);
            cpByDedup.add(row.dedupKey);
          } else {
            despesaValues.push({
              descricao: desc,
              valor: String(row.saida),
              dataVencimento: row.data,
              dataPagamento: row.data,
              status: "pago",
              categoria: mapCategoriaPagar(row.categoria),
              observacoes: [row.categoria, row.subcategoria, row.conta, row.observacao]
                .filter(Boolean)
                .join(" · ")
                .slice(0, 500),
              importDedupKey: row.dedupKey,
            });
            cpByDedup.add(row.dedupKey);
          }
        }
      }

      // Marca dedup em lançamentos antigos (import sem chave) para o próximo reimport.
      for (const chunk of chunks(receitaBackfill)) {
        await Promise.all(
          chunk.map((b) =>
            db
              .update(receitasDia)
              .set({ importDedupKey: b.key })
              .where(and(eq(receitasDia.id, b.id), sql`${receitasDia.importDedupKey} IS NULL`)),
          ),
        );
      }
      for (const chunk of chunks(cpBackfill)) {
        await Promise.all(
          chunk.map((b) =>
            db
              .update(contasPagar)
              .set({ importDedupKey: b.key })
              .where(and(eq(contasPagar.id, b.id), sql`${contasPagar.importDedupKey} IS NULL`)),
          ),
        );
      }

      let movIns = 0;
      for (const chunk of chunks(movValues)) {
        try {
          const r = await db.insert(bancoMovimentacoes).values(chunk).returning({ id: bancoMovimentacoes.id });
          movIns += r.length;
        } catch (e: any) {
          // Fallback linha a linha se o lote colidir (reimport concorrente)
          if (!/unique|duplicate/i.test(String(e?.message ?? e))) throw e;
          for (const row of chunk) {
            try {
              await db.insert(bancoMovimentacoes).values(row);
              movIns++;
            } catch {
              result.extratoDuplicados++;
            }
          }
        }
      }
      let recIns = 0;
      for (const chunk of chunks(receitaValues)) {
        try {
          const r = await db.insert(receitasDia).values(chunk).returning({ id: receitasDia.id });
          recIns += r.length;
        } catch (e: any) {
          if (!/unique|duplicate/i.test(String(e?.message ?? e))) throw e;
          for (const row of chunk) {
            try {
              await db.insert(receitasDia).values(row);
              recIns++;
            } catch {
              result.receitasDuplicadas++;
            }
          }
        }
      }
      let despIns = 0;
      for (const chunk of chunks(despesaValues)) {
        try {
          const r = await db.insert(contasPagar).values(chunk).returning({ id: contasPagar.id });
          despIns += r.length;
        } catch (e: any) {
          if (!/unique|duplicate/i.test(String(e?.message ?? e))) throw e;
          for (const row of chunk) {
            try {
              await db.insert(contasPagar).values(row);
              despIns++;
            } catch {
              result.despesasDuplicadas++;
            }
          }
        }
      }
      result.extratoInseridos = movIns;
      result.extratoDuplicados += Math.max(0, movValues.length - movIns);
      result.receitasInseridas = recIns;
      result.receitasDuplicadas += Math.max(0, receitaValues.length - recIns);
      result.despesasInseridas = despIns;
      result.despesasDuplicadas += Math.max(0, despesaValues.length - despIns);

      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Fluxo ─────────────────────────────────────────────────────────────
  app.get("/api/financeiro/fluxo", authorize("admin", "gestor"), async (req, res) => {
    try {
      const hoje = hojeBrasil();
      const isoRe = /^\d{4}-\d{2}-\d{2}$/;
      let de = isoRe.test(String(req.query.de ?? "")) ? String(req.query.de) : addDias(hoje, -30);
      const ate = isoRe.test(String(req.query.ate ?? "")) ? String(req.query.ate) : addDias(hoje, 60);
      const incluirDas = ["1", "true"].includes(String(req.query.incluirDas ?? "").toLowerCase());
      const incluirProLabore = !["0", "false"].includes(String(req.query.incluirProLabore ?? "1").toLowerCase());
      const deFoiDefault = !isoRe.test(String(req.query.de ?? ""));

      // Conta ativa (importação de extrato/planilha desativa as demais).
      let [conta] = await db
        .select()
        .from(bancoContas)
        .where(eq(bancoContas.ativo, true))
        .orderBy(desc(bancoContas.createdAt))
        .limit(1);
      if (!conta) {
        [conta] = await db
          .select()
          .from(bancoContas)
          .where(and(eq(bancoContas.agencia, "planilha"), eq(bancoContas.conta, "planilha-consolidada")))
          .limit(1);
      }
      const movs = conta
        ? await db.select().from(bancoMovimentacoes).where(eq(bancoMovimentacoes.contaId, conta.id))
        : [];
      const regras = await db.select().from(proLaboreRegras);
      const ancoraData = conta?.saldoInicialData ?? null;
      const ancoraValor = conta?.saldoInicialValor != null ? parseFloat(String(conta.saldoInicialValor)) : null;

      // Sem ?de= explícito: abre a janela até o início do extrato/âncora.
      if (deFoiDefault) {
        const datasMov = movs.map((m) => m.data);
        const candidatas = [ancoraData, ...datasMov].filter((x): x is string => !!x);
        if (candidatas.length) {
          const inicio = candidatas.reduce((a, b) => (a < b ? a : b));
          if (inicio < de) de = inicio;
        }
      }

      const realPorDia = new Map<string, ReturnType<typeof emptyDiaReal>>();
      let saldoRealHoje: number | null = ancoraValor;
      let ultimaDataExtrato: string | null = null;

      for (const m of movs) {
        const valor = parseFloat(String(m.valor));
        if (ultimaDataExtrato == null || m.data > ultimaDataExtrato) ultimaDataExtrato = m.data;
        const dia = realPorDia.get(m.data) ?? emptyDiaReal();
        if (m.tipo === "C") {
          dia.entradas += valor;
        } else {
          const nat = resolveDebitoNatureza(m.historico, m.prolaboreOverride, regras);
          if (nat.natureza === "excluido") {
            // Mantém no cash do extrato, mas fora dos buckets de P&L.
          } else {
            dia.saidas += valor;
            if (nat.natureza === "pro_labore") dia.saidasProLabore += valor;
            else dia.saidasEmpresa += valor;
          }
        }
        realPorDia.set(m.data, dia);
        if (saldoRealHoje != null && ancoraData != null && m.data > ancoraData && m.data <= hoje) {
          saldoRealHoje += m.tipo === "C" ? valor : -valor;
        }
      }
      if (saldoRealHoje != null) saldoRealHoje = round2(saldoRealHoje);

      const recsAbertas = await db.select().from(recebiveis).where(eq(recebiveis.status, "aberta"));
      const cps = await db
        .select()
        .from(contasPagar)
        .where(
          incluirDas
            ? inArray(contasPagar.status, ["pendente", "vencido"])
            : and(
                inArray(contasPagar.status, ["pendente", "vencido"]),
                sql`${contasPagar.categoria} IS DISTINCT FROM 'DAS'`,
              ),
        );
      const cpsPagos = await db.select().from(contasPagar).where(eq(contasPagar.status, "pago"));

      const receitas = await db.select().from(receitasDia);

      const aReceber30 = round2(
        recsAbertas
          .filter((r) => r.dataVencimento >= hoje && r.dataVencimento <= addDias(hoje, 30))
          .reduce((s, r) => s + parseFloat(String(r.valor)), 0),
      );
      const aPagar30 = round2(
        cps
          .filter((c) => c.dataVencimento >= hoje && c.dataVencimento <= addDias(hoje, 30))
          .reduce((s, c) => s + parseFloat(String(c.valor)), 0),
      );

      let saldoNoInicio: number | null = null;
      if (ancoraValor != null && ancoraData != null) {
        let s = ancoraValor;
        for (const m of movs) {
          if (m.data > ancoraData && m.data < de) s += (m.tipo === "C" ? 1 : -1) * parseFloat(String(m.valor));
        }
        saldoNoInicio = s;
      }

      const serie: any[] = [];
      const dias: any[] = [];
      let saldoRealCorrente = saldoNoInicio;
      let saldoProjetado = saldoRealHoje;
      const loopInicio = de <= hoje ? de : hoje;

      for (let d = loopInicio; d <= ate; d = addDias(d, 1)) {
        const emitir = d >= de;
        if (d < hoje) {
          const real = realPorDia.get(d) ?? emptyDiaReal();
          const receitaDiaRows = receitas.filter((r) => r.data === d);
          const receitaDia = receitaDiaRows.reduce((s, r) => s + parseFloat(String(r.valor)), 0);
          if (saldoRealCorrente != null && ancoraData != null && d > ancoraData) {
            saldoRealCorrente = round2(saldoRealCorrente + real.entradas - real.saidas);
          }
          if (emitir)
            serie.push({
              data: d,
              entradasReal: round2(real.entradas),
              saidasReal: round2(incluirProLabore ? real.saidas : real.saidasEmpresa),
              saidasEmpresaReal: round2(real.saidasEmpresa),
              saidasProLaboreReal: round2(real.saidasProLabore),
              receitaDia: round2(receitaDia),
              saldoReal: d >= (ancoraData ?? "") ? saldoRealCorrente : null,
            });
          // Receitas e despesas passadas entram na timeline pra permitir CRUD
          if (emitir) {
            const saidasPagas = cpsPagos.filter(
              (c) => (c.dataPagamento || c.dataVencimento) === d,
            );
            if (receitaDiaRows.length || saidasPagas.length) {
              const totalEnt = receitaDiaRows.reduce((s, r) => s + parseFloat(String(r.valor)), 0);
              const totalSai = saidasPagas.reduce((s, c) => s + parseFloat(String(c.valor)), 0);
              dias.push({
                data: d,
                totalEntradas: round2(totalEnt),
                totalSaidas: round2(totalSai),
                saldoProjetado: saldoRealCorrente,
                isPassado: true,
                entradas: receitaDiaRows.map((x) => ({
                  id: x.id,
                  tipo: "receita" as const,
                  clienteNome: `Receita ${x.forma}`,
                  descricao: x.observacao,
                  valor: parseFloat(String(x.valor)),
                  forma: x.forma,
                  observacao: x.observacao,
                })),
                saidas: saidasPagas.map((x) => ({
                  id: x.id,
                  tipo: "pagar" as const,
                  descricao: x.descricao,
                  valor: parseFloat(String(x.valor)),
                  categoria: x.categoria,
                  dataVencimento: x.dataVencimento,
                  status: x.status,
                  recorrencia: x.recorrencia,
                  observacoes: x.observacoes,
                })),
              });
            }
          }
        } else {
          const abertasDia = recsAbertas.filter((x) => x.dataVencimento === d);
          let saidasDia = cps.filter((x) => x.dataVencimento === d);
          if (!incluirProLabore) {
            saidasDia = saidasDia.filter((x) => x.categoria !== "Pró-labore");
          }
          const receitasDoDia = receitas.filter((r) => r.data === d);
          const totalReceitasDia = receitasDoDia.reduce((s, r) => s + parseFloat(String(r.valor)), 0);
          const totalEntradas =
            abertasDia.reduce((s, x) => s + parseFloat(String(x.valor)), 0) +
            (d === hoje ? 0 : totalReceitasDia);
          const totalSaidas = saidasDia.reduce((s, x) => s + parseFloat(String(x.valor)), 0);

          if (saldoProjetado != null) {
            saldoProjetado = round2(saldoProjetado + totalEntradas - totalSaidas);
          }

          const ponto: any = {
            data: d,
            entradasPrevistas: round2(totalEntradas),
            saidasPrevistas: round2(totalSaidas),
            receitaDia: round2(totalReceitasDia),
            saldoProjetado,
          };
          if (d === hoje) {
            const real = realPorDia.get(d) ?? emptyDiaReal();
            ponto.entradasReal = round2(real.entradas);
            ponto.saidasReal = round2(incluirProLabore ? real.saidas : real.saidasEmpresa);
            ponto.saidasEmpresaReal = round2(real.saidasEmpresa);
            ponto.saidasProLaboreReal = round2(real.saidasProLabore);
            ponto.saldoReal = saldoRealHoje;
          }
          if (emitir) serie.push(ponto);

          if (emitir && (d === hoje || abertasDia.length || saidasDia.length || receitasDoDia.length)) {
            dias.push({
              data: d,
              totalEntradas: round2(totalEntradas),
              totalSaidas: round2(totalSaidas),
              saldoProjetado,
              isHoje: d === hoje,
              entradas: [
                ...abertasDia.map((x) => ({
                  id: x.id,
                  tipo: "recebivel" as const,
                  clienteNome: x.clienteNome,
                  descricao: x.descricao,
                  valor: parseFloat(String(x.valor)),
                  dataVencimento: x.dataVencimento,
                  status: x.status,
                  observacoes: x.observacoes,
                  recorrencia: x.recorrencia,
                  parcelaAtual: x.parcelaAtual,
                  totalParcelas: x.totalParcelas,
                })),
                ...receitasDoDia.map((x) => ({
                  id: x.id,
                  tipo: "receita" as const,
                  clienteNome: `Receita ${x.forma}`,
                  descricao: x.observacao,
                  valor: parseFloat(String(x.valor)),
                  forma: x.forma,
                  observacao: x.observacao,
                  data: x.data,
                })),
              ],
              saidas: saidasDia.map((x) => ({
                id: x.id,
                tipo: "pagar" as const,
                descricao: x.descricao,
                valor: parseFloat(String(x.valor)),
                categoria: x.categoria,
                dataVencimento: x.dataVencimento,
                status: x.status,
                recorrencia: x.recorrencia,
                observacoes: x.observacoes,
              })),
            });
          }
        }
      }

      // Metas do mês
      const [y, m] = hoje.split("-").map(Number);
      const [meta] = await db.select().from(metasConfig).where(eq(metasConfig.chave, "global")).limit(1);
      const faturamentoMes = sumReceitasMes(receitas, y, m);
      const fixos = await db.select().from(custosFixos).where(eq(custosFixos.ativo, true));
      const totalFixos = fixos.reduce((s, c) => s + parseFloat(String(c.valorMensal)), 0);
      const prefix = `${y}-${String(m).padStart(2, "0")}`;
      const cpsMes = cps
        .filter((c) => c.dataVencimento.startsWith(prefix))
        .reduce((s, c) => s + parseFloat(String(c.valor)), 0);
      const minimo = calcMinimoSobrevivencia({
        contasPagarMes: cpsMes,
        custosFixos: totalFixos,
        custosVariaveis: 0,
      });
      const pe = calcPontoEquilibrio(totalFixos, Number(meta?.margemContribuicaoPct ?? 60));

      dias.sort((a, b) => (a.data > b.data ? -1 : a.data < b.data ? 1 : 0));

      res.json({
        hoje,
        de,
        ate,
        conta: conta
          ? { id: conta.id, nome: conta.nome, agencia: conta.agencia, conta: conta.conta }
          : null,
        saldoRealHoje,
        saldoProjetadoHoje:
          serie.find((s) => s.data === hoje)?.saldoProjetado ?? saldoRealHoje,
        ultimaDataExtrato,
        aReceber30,
        aPagar30,
        serie,
        dias,
        metas: {
          metaFaturamento: Number(meta?.metaFaturamento ?? 0),
          realizado: faturamentoMes,
          projecao: faturamentoMes,
          minimo,
          pontoEquilibrio: pe,
        },
        categorias: (
          await db
            .select({ nome: categorias.nome })
            .from(categorias)
            .where(eq(categorias.ativo, true))
            .orderBy(asc(categorias.ordem), asc(categorias.nome))
        ).map((c) => c.nome),
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Receitas do dia ───────────────────────────────────────────────────
  app.get("/api/receitas-dia", async (req, res) => {
    const de = String(req.query.de ?? "");
    const ate = String(req.query.ate ?? "");
    const conds = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(de)) conds.push(gte(receitasDia.data, de));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) conds.push(lte(receitasDia.data, ate));
    const rows = await db
      .select()
      .from(receitasDia)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(receitasDia.data));
    res.json(rows);
  });

  app.post("/api/receitas-dia", authorize("admin", "gestor"), async (req, res) => {
    const { data, valor, forma, observacao } = req.body ?? {};
    if (!data || valor == null || !forma) {
      return res.status(400).json({ message: "data, valor e forma obrigatórios" });
    }
    if (!["dinheiro", "pix", "cartao"].includes(forma)) {
      return res.status(400).json({ message: "forma inválida" });
    }
    // Receita negativa inflaria o saldo projetado ao contrário. Mesmo buraco.
    const vp = parseValorPositivo(valor);
    if (!vp.ok) return res.status(400).json({ message: vp.erro });
    const [row] = await db
      .insert(receitasDia)
      .values({
        data: String(data),
        valor: String(vp.valor),
        forma,
        observacao: observacao ?? null,
      })
      .returning();
    res.status(201).json(row);
  });

  app.patch("/api/receitas-dia/:id", authorize("admin", "gestor"), async (req, res) => {
    const body = req.body ?? {};
    if (body.forma != null && !["dinheiro", "pix", "cartao"].includes(body.forma)) {
      return res.status(400).json({ message: "forma inválida" });
    }
    const vpPatch = parseValorPositivoOpcional(body.valor);
    if (vpPatch && !vpPatch.ok) return res.status(400).json({ message: vpPatch.erro });
    const patch: Record<string, unknown> = {};
    if (body.data != null) patch.data = String(body.data);
    if (vpPatch?.ok) patch.valor = String(vpPatch.valor);
    if (body.forma != null) patch.forma = body.forma;
    if (body.observacao !== undefined) patch.observacao = body.observacao;
    const [row] = await db
      .update(receitasDia)
      .set(patch as any)
      .where(eq(receitasDia.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ message: "Não encontrado" });
    res.json(row);
  });

  app.delete("/api/receitas-dia/:id", authorize("admin", "gestor"), async (req, res) => {
    await db.delete(receitasDia).where(eq(receitasDia.id, req.params.id));
    res.json({ ok: true });
  });

  // ── Contas a pagar ────────────────────────────────────────────────────
  app.get("/api/contas-pagar", async (req, res) => {
    const status = req.query.status ? String(req.query.status).split(",") : null;
    const hoje = hojeBrasil();

    /*
     * "Vencido" continua sendo ESTADO GRAVADO, não derivado na leitura: outras
     * rotas leem a coluna status direto do banco (o Fluxo filtra
     * status IN ('pendente','vencido')) e o import do CSV já grava "vencido".
     * Derivar só aqui deixaria duas definições de vencida no sistema.
     *
     * O que muda é o CUSTO: antes era um SELECT + um UPDATE por linha vencida
     * dentro do laço (1 + N queries por GET). Agora é UM UPDATE em lote com
     * WHERE, antes do SELECT — 2 queries fixas, e a segunda chamada no mesmo dia
     * atualiza 0 linhas (idempotente de verdade, não convergente à força de N
     * escritas).
     */
    await db
      .update(contasPagar)
      .set({ status: "vencido" })
      .where(and(eq(contasPagar.status, "pendente"), lt(contasPagar.dataVencimento, hoje)));

    // Desempate estável: duas contas do mesmo dia precisam sair SEMPRE na mesma
    // ordem. Sem isto, marcar uma conta como paga embaralhava as vizinhas de
    // 03/09 entre duas cargas — o Postgres não promete ordem em empate.
    let rows = await db
      .select()
      .from(contasPagar)
      .orderBy(desc(contasPagar.dataVencimento), asc(contasPagar.createdAt), asc(contasPagar.id));

    if (status) rows = rows.filter((r) => status.includes(r.status));
    res.json(rows);
  });

  app.post("/api/contas-pagar", authorize("admin", "gestor"), async (req, res) => {
    const { descricao, valor, dataVencimento, categoria, observacoes, recorrencia, totalParcelas } =
      req.body ?? {};
    if (!descricao || valor == null || !dataVencimento) {
      return res.status(400).json({ message: "descricao, valor, dataVencimento obrigatórios" });
    }
    // Uma conta a pagar de valor negativo REDUZIA o total devido. Não existe.
    const vp = parseValorPositivo(valor);
    if (!vp.ok) return res.status(400).json({ message: vp.erro });

    const nParcelas = normalizaTotalParcelas(totalParcelas);
    const isParcelado = nParcelas >= 2 && recorrencia !== "mensal";

    if (isParcelado) {
      const values = datasParcelasMensais(String(dataVencimento), nParcelas).map((venc, i) => ({
        descricao: String(descricao),
        valor: String(vp.valor),
        dataVencimento: venc,
        categoria: categoria ?? null,
        observacoes: observacoes ?? null,
        recorrencia: null as null,
        parcelaAtual: i + 1,
        totalParcelas: nParcelas,
        status: "pendente" as const,
      }));
      const rows = await db.insert(contasPagar).values(values).returning();
      return res.status(201).json({ parcelas: rows, count: rows.length });
    }

    const [row] = await db
      .insert(contasPagar)
      .values({
        descricao: String(descricao),
        valor: String(vp.valor),
        dataVencimento: String(dataVencimento),
        categoria: categoria ?? null,
        observacoes: observacoes ?? null,
        recorrencia: recorrencia === "mensal" ? "mensal" : null,
        parcelaAtual: null,
        totalParcelas: null,
        status: "pendente",
      })
      .returning();
    res.status(201).json(row);
  });

  app.post(
    "/api/contas-pagar/parse-csv",
    authorize("admin", "gestor"),
    extratoUpload.single("file"),
    async (req: any, res) => {
      try {
        const texto = req.file?.buffer?.toString("utf-8") ?? "";
        const parsed = parseGendoContasPagarCsv(texto, hojeBrasil());
        res.json(parsed);
      } catch (e: any) {
        res.status(400).json({ message: e.message || "Falha ao parsear CSV" });
      }
    },
  );

  app.post("/api/contas-pagar/import-csv", authorize("admin", "gestor"), async (req, res) => {
    try {
      const rows = (req.body?.rows ?? []) as {
        descricao: string;
        valor: number;
        dataVencimento: string;
        categoria: string;
        status: "pendente" | "pago" | "vencido";
        dataPagamento: string | null;
        observacoes: string | null;
        importDedupKey: string;
      }[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows obrigatório" });
      }
      // O corpo vem do preview, mas quem chama a rota é o cliente: mesma guarda.
      for (const [i, r] of rows.entries()) {
        const vp = parseValorPositivo(r.valor);
        if (!vp.ok) {
          return res
            .status(400)
            .json({ message: `Linha ${i + 1} (“${r.descricao ?? "?"}”): ${vp.erro.toLowerCase()}` });
        }
        r.valor = vp.valor;
      }

      const existing = await db
        .select({ importDedupKey: contasPagar.importDedupKey })
        .from(contasPagar);
      const keys = new Set(existing.map((x) => x.importDedupKey).filter(Boolean));

      const toInsert = rows.filter((r) => r.importDedupKey && !keys.has(r.importDedupKey));
      const duplicadas = rows.length - toInsert.length;

      const BATCH = 100;
      let inseridas = 0;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const chunk = toInsert.slice(i, i + BATCH).map((r) => ({
          descricao: r.descricao,
          valor: String(r.valor),
          dataVencimento: r.dataVencimento,
          dataPagamento: r.dataPagamento,
          status: r.status,
          categoria: r.categoria,
          observacoes: r.observacoes,
          importDedupKey: r.importDedupKey,
        }));
        try {
          const ins = await db.insert(contasPagar).values(chunk).returning({ id: contasPagar.id });
          inseridas += ins.length;
        } catch {
          for (const row of chunk) {
            try {
              await db.insert(contasPagar).values(row);
              inseridas++;
            } catch {
              /* dup */
            }
          }
        }
      }

      res.json({ inseridas, duplicadas, total: rows.length });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/contas-pagar/:id", authorize("admin", "gestor"), async (req, res) => {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    for (const k of [
      "descricao",
      "valor",
      "dataVencimento",
      "categoria",
      "observacoes",
      "status",
      "dataPagamento",
      "recorrencia",
    ]) {
      if (body[k] !== undefined) patch[k] = body[k] == null ? null : String(body[k]);
    }
    // Editar para −50 seria o mesmo buraco do POST pela porta dos fundos.
    const vpPatch = parseValorPositivoOpcional(body.valor);
    if (vpPatch && !vpPatch.ok) return res.status(400).json({ message: vpPatch.erro });
    if (vpPatch?.ok) patch.valor = String(vpPatch.valor);
    if (patch.recorrencia !== undefined) patch.recorrencia = body.recorrencia === "mensal" ? "mensal" : null;
    if (body.parcelaAtual !== undefined) {
      patch.parcelaAtual = body.parcelaAtual == null ? null : Number(body.parcelaAtual);
    }
    if (body.totalParcelas !== undefined) {
      patch.totalParcelas = body.totalParcelas == null ? null : Number(body.totalParcelas);
    }

    const [atual] = await db.select().from(contasPagar).where(eq(contasPagar.id, req.params.id)).limit(1);
    if (!atual) return res.status(404).json({ message: "Não encontrado" });

    // Baixa com recorrência mensal → cria próxima parcela
    const ficouMensal =
      patch.recorrencia !== undefined ? patch.recorrencia === "mensal" : atual.recorrencia === "mensal";
    if (patch.status === "pago" && ficouMensal && atual.status !== "pago") {
      const baseVenc = String(patch.dataVencimento ?? atual.dataVencimento);
      const nextVenc = proximoVencimentoMensal(baseVenc);
      await db.insert(contasPagar).values({
        descricao: String(patch.descricao ?? atual.descricao),
        valor: String(patch.valor ?? atual.valor),
        dataVencimento: nextVenc,
        categoria: (patch.categoria as string) ?? atual.categoria,
        observacoes: (patch.observacoes as string) ?? atual.observacoes,
        recorrencia: "mensal",
        status: "pendente",
      });
      if (!patch.dataPagamento) patch.dataPagamento = hojeBrasil();
    }

    const [row] = await db.update(contasPagar).set(patch as any).where(eq(contasPagar.id, req.params.id)).returning();
    res.json(row);
  });

  app.delete("/api/contas-pagar/:id", authorize("admin", "gestor"), async (req, res) => {
    await db.delete(contasPagar).where(eq(contasPagar.id, req.params.id));
    res.json({ ok: true });
  });

  // ── Contas a receber ──────────────────────────────────────────────────
  app.get("/api/recebiveis", async (req, res) => {
    const status = req.query.status ? String(req.query.status).split(",") : null;
    let rows = await db.select().from(recebiveis).orderBy(asc(recebiveis.dataVencimento));
    if (status) rows = rows.filter((r) => status.includes(r.status));
    res.json(rows);
  });

  app.post("/api/recebiveis", authorize("admin", "gestor"), async (req, res) => {
    const { clienteNome, descricao, valor, dataVencimento, observacoes, recorrencia, totalParcelas } =
      req.body ?? {};
    if (!clienteNome || valor == null || !dataVencimento) {
      return res.status(400).json({ message: "clienteNome, valor, dataVencimento obrigatórios" });
    }
    // Mesmo buraco de contas a pagar, do outro lado do caixa.
    const vp = parseValorPositivo(valor);
    if (!vp.ok) return res.status(400).json({ message: vp.erro });

    const nParcelas = normalizaTotalParcelas(totalParcelas);
    const isParcelado = nParcelas >= 2 && recorrencia !== "mensal";

    // Pacote parcelado: N recebíveis mensais com o mesmo valor de parcela.
    if (isParcelado) {
      const values = datasParcelasMensais(String(dataVencimento), nParcelas).map((venc, i) => ({
        clienteNome: String(clienteNome),
        descricao: descricao ?? null,
        valor: String(vp.valor),
        dataVencimento: venc,
        observacoes: observacoes ?? null,
        recorrencia: null as null,
        parcelaAtual: i + 1,
        totalParcelas: nParcelas,
        status: "aberta" as const,
      }));
      const rows = await db.insert(recebiveis).values(values).returning();
      return res.status(201).json({ parcelas: rows, count: rows.length });
    }

    const [row] = await db
      .insert(recebiveis)
      .values({
        clienteNome: String(clienteNome),
        descricao: descricao ?? null,
        valor: String(vp.valor),
        dataVencimento: String(dataVencimento),
        observacoes: observacoes ?? null,
        recorrencia: recorrencia === "mensal" ? "mensal" : null,
        parcelaAtual: null,
        totalParcelas: null,
        status: "aberta",
      })
      .returning();
    res.status(201).json(row);
  });

  app.patch("/api/recebiveis/:id", authorize("admin", "gestor"), async (req, res) => {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    for (const k of [
      "clienteNome",
      "descricao",
      "valor",
      "dataVencimento",
      "observacoes",
      "status",
      "dataPagamento",
      "valorPago",
      "recorrencia",
    ]) {
      if (body[k] !== undefined) patch[k] = body[k] == null ? null : String(body[k]);
    }
    const vpPatch = parseValorPositivoOpcional(body.valor);
    if (vpPatch && !vpPatch.ok) return res.status(400).json({ message: vpPatch.erro });
    if (vpPatch?.ok) patch.valor = String(vpPatch.valor);
    // valorPago também é dinheiro: aceita ficar em branco, nunca negativo.
    const vpPago = parseValorPositivoOpcional(body.valorPago);
    if (body.valorPago != null && vpPago && !vpPago.ok) {
      return res.status(400).json({ message: vpPago.erro });
    }
    if (vpPago?.ok) patch.valorPago = String(vpPago.valor);
    if (patch.recorrencia !== undefined) {
      patch.recorrencia = body.recorrencia === "mensal" ? "mensal" : null;
    }
    if (body.parcelaAtual !== undefined) {
      patch.parcelaAtual = body.parcelaAtual == null ? null : Number(body.parcelaAtual);
    }
    if (body.totalParcelas !== undefined) {
      patch.totalParcelas = body.totalParcelas == null ? null : Number(body.totalParcelas);
    }

    const [atual] = await db
      .select()
      .from(recebiveis)
      .where(eq(recebiveis.id, req.params.id))
      .limit(1);
    if (!atual) return res.status(404).json({ message: "Não encontrado" });

    // Baixa com recorrência mensal → já cria o recebível do mês seguinte.
    const ficouMensal =
      patch.recorrencia !== undefined
        ? patch.recorrencia === "mensal"
        : atual.recorrencia === "mensal";
    if (patch.status === "paga" && ficouMensal && atual.status !== "paga") {
      const baseVenc = String(patch.dataVencimento ?? atual.dataVencimento);
      await db.insert(recebiveis).values({
        clienteNome: String(patch.clienteNome ?? atual.clienteNome),
        descricao: (patch.descricao as string) ?? atual.descricao,
        valor: String(patch.valor ?? atual.valor),
        dataVencimento: proximoVencimentoMensal(baseVenc),
        observacoes: (patch.observacoes as string) ?? atual.observacoes,
        recorrencia: "mensal",
        status: "aberta",
      });
    }

    if (patch.status === "paga" && !patch.dataPagamento) patch.dataPagamento = hojeBrasil();
    const [row] = await db.update(recebiveis).set(patch as any).where(eq(recebiveis.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ message: "Não encontrado" });
    res.json(row);
  });

  app.delete("/api/recebiveis/:id", authorize("admin", "gestor"), async (req, res) => {
    await db.delete(recebiveis).where(eq(recebiveis.id, req.params.id));
    res.json({ ok: true });
  });

  // ── Categorias ────────────────────────────────────────────────────────
  app.get("/api/categorias", async (req, res) => {
    const todos = String(req.query.todos ?? "") === "1";
    const rows = await db
      .select()
      .from(categorias)
      .where(todos ? undefined : eq(categorias.ativo, true))
      .orderBy(asc(categorias.ordem), asc(categorias.nome));
    res.json(rows);
  });

  app.post("/api/categorias", authorize("admin", "gestor"), async (req, res) => {
    const nome = String(req.body?.nome ?? "").trim();
    if (!nome) return res.status(400).json({ message: "nome obrigatório" });
    const [dup] = await db
      .select({ id: categorias.id })
      .from(categorias)
      .where(sql`lower(${categorias.nome}) = lower(${nome})`)
      .limit(1);
    if (dup) return res.status(409).json({ message: "Já existe uma categoria com esse nome" });

    const [{ maxOrdem }] = await db
      .select({ maxOrdem: sql<number>`coalesce(max(${categorias.ordem}), 0)` })
      .from(categorias);
    const ordem =
      req.body?.ordem != null && Number.isFinite(Number(req.body.ordem))
        ? Number(req.body.ordem)
        : Number(maxOrdem) + 1;

    try {
      const [row] = await db
        .insert(categorias)
        .values({
          nome,
          ordem,
          ativo: req.body?.ativo !== false,
        })
        .returning();
      res.status(201).json(row);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("idx_categorias_nome_lower")) {
        return res.status(409).json({ message: "Já existe uma categoria com esse nome" });
      }
      throw e;
    }
  });

  app.patch("/api/categorias/:id", authorize("admin", "gestor"), async (req, res) => {
    const body = req.body ?? {};
    const [atual] = await db.select().from(categorias).where(eq(categorias.id, req.params.id)).limit(1);
    if (!atual) return res.status(404).json({ message: "Não encontrado" });

    const patch: Partial<typeof categorias.$inferInsert> = {};
    if (body.nome != null) {
      const nome = String(body.nome).trim();
      if (!nome) return res.status(400).json({ message: "nome inválido" });
      const [dup] = await db
        .select({ id: categorias.id })
        .from(categorias)
        .where(and(sql`lower(${categorias.nome}) = lower(${nome})`, ne(categorias.id, atual.id)))
        .limit(1);
      if (dup) return res.status(409).json({ message: "Já existe uma categoria com esse nome" });
      patch.nome = nome;
    }
    if (body.ordem != null) patch.ordem = Number(body.ordem) || 0;
    if (body.ativo !== undefined) patch.ativo = !!body.ativo;

    try {
      const [row] = await db
        .update(categorias)
        .set(patch)
        .where(eq(categorias.id, req.params.id))
        .returning();
      if (patch.nome && patch.nome !== atual.nome) {
        await db
          .update(contasPagar)
          .set({ categoria: patch.nome })
          .where(eq(contasPagar.categoria, atual.nome));
        await db
          .update(custosFixos)
          .set({ categoria: patch.nome })
          .where(eq(custosFixos.categoria, atual.nome));
      }
      res.json(row);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("idx_categorias_nome_lower")) {
        return res.status(409).json({ message: "Já existe uma categoria com esse nome" });
      }
      throw e;
    }
  });

  app.delete("/api/categorias/:id", authorize("admin", "gestor"), async (req, res) => {
    const [atual] = await db.select().from(categorias).where(eq(categorias.id, req.params.id)).limit(1);
    if (!atual) return res.status(404).json({ message: "Não encontrado" });

    const [{ nPagar }] = await db
      .select({ nPagar: sql<number>`count(*)::int` })
      .from(contasPagar)
      .where(eq(contasPagar.categoria, atual.nome));
    const [{ nFixos }] = await db
      .select({ nFixos: sql<number>`count(*)::int` })
      .from(custosFixos)
      .where(eq(custosFixos.categoria, atual.nome));
    const emUso = Number(nPagar) > 0 || Number(nFixos) > 0;

    if (emUso) {
      const [row] = await db
        .update(categorias)
        .set({ ativo: false })
        .where(eq(categorias.id, atual.id))
        .returning();
      return res.json({ ok: true, softDeleted: true, categoria: row });
    }

    await db.delete(categorias).where(eq(categorias.id, atual.id));
    res.json({ ok: true, softDeleted: false });
  });

  // ── Custos fixos ──────────────────────────────────────────────────────
  app.get("/api/custos-fixos", async (_req, res) => {
    res.json(await db.select().from(custosFixos).orderBy(asc(custosFixos.descricao)));
  });

  app.post("/api/custos-fixos", authorize("admin", "gestor"), async (req, res) => {
    const { descricao, categoria, valorMensal, dataInicio, dataFim, ativo } = req.body ?? {};
    if (!descricao || !categoria || !dataInicio) {
      return res.status(400).json({ message: "descricao, categoria, dataInicio obrigatórios" });
    }
    const [row] = await db
      .insert(custosFixos)
      .values({
        descricao: String(descricao),
        categoria: String(categoria),
        valorMensal: String(valorMensal ?? 0),
        dataInicio: String(dataInicio),
        dataFim: dataFim ?? null,
        ativo: ativo !== false,
      })
      .returning();
    res.status(201).json(row);
  });

  app.put("/api/custos-fixos/:id", authorize("admin", "gestor"), async (req, res) => {
    const body = req.body ?? {};
    const [row] = await db
      .update(custosFixos)
      .set({
        ...(body.descricao != null ? { descricao: String(body.descricao) } : {}),
        ...(body.categoria != null ? { categoria: String(body.categoria) } : {}),
        ...(body.valorMensal != null ? { valorMensal: String(body.valorMensal) } : {}),
        ...(body.dataInicio != null ? { dataInicio: String(body.dataInicio) } : {}),
        ...(body.dataFim !== undefined ? { dataFim: body.dataFim } : {}),
        ...(body.ativo !== undefined ? { ativo: !!body.ativo } : {}),
      })
      .where(eq(custosFixos.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ message: "Não encontrado" });
    res.json(row);
  });

  app.delete("/api/custos-fixos/:id", authorize("admin", "gestor"), async (req, res) => {
    await db.delete(custosFixos).where(eq(custosFixos.id, req.params.id));
    res.json({ ok: true });
  });

  // ── Metas / PE ────────────────────────────────────────────────────────
  app.get("/api/metas", async (_req, res) => {
    const [meta] = await db.select().from(metasConfig).where(eq(metasConfig.chave, "global")).limit(1);
    const hoje = hojeBrasil();
    const [y, m] = hoje.split("-").map(Number);
    const receitas = await db.select().from(receitasDia);
    const realizado = sumReceitasMes(receitas, y, m);
    const fixos = await db.select().from(custosFixos).where(eq(custosFixos.ativo, true));
    const totalFixos = fixos.reduce((s, c) => s + parseFloat(String(c.valorMensal)), 0);
    const margem = Number(meta?.margemContribuicaoPct ?? 60);
    res.json({
      metaFaturamento: Number(meta?.metaFaturamento ?? 0),
      margemContribuicaoPct: margem,
      realizado,
      minimo: calcMinimoSobrevivencia({ contasPagarMes: 0, custosFixos: totalFixos, custosVariaveis: 0 }),
      pontoEquilibrio: calcPontoEquilibrio(totalFixos, margem),
      custosFixosTotal: roundMoney2(totalFixos),
    });
  });

  app.put("/api/metas", authorize("admin", "gestor"), async (req, res) => {
    const { metaFaturamento, margemContribuicaoPct } = req.body ?? {};
    const [existing] = await db.select().from(metasConfig).where(eq(metasConfig.chave, "global")).limit(1);
    if (existing) {
      const [row] = await db
        .update(metasConfig)
        .set({
          ...(metaFaturamento != null ? { metaFaturamento: String(metaFaturamento) } : {}),
          ...(margemContribuicaoPct != null ? { margemContribuicaoPct: String(margemContribuicaoPct) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(metasConfig.id, existing.id))
        .returning();
      return res.json(row);
    }
    const [row] = await db
      .insert(metasConfig)
      .values({
        chave: "global",
        metaFaturamento: String(metaFaturamento ?? 0),
        margemContribuicaoPct: String(margemContribuicaoPct ?? 60),
      })
      .returning();
    res.json(row);
  });

  app.get("/api/ponto-equilibrio", async (_req, res) => {
    const [meta] = await db.select().from(metasConfig).where(eq(metasConfig.chave, "global")).limit(1);
    const fixos = await db.select().from(custosFixos).where(eq(custosFixos.ativo, true));
    const totalFixos = fixos.reduce((s, c) => s + parseFloat(String(c.valorMensal)), 0);
    const margem = Number(meta?.margemContribuicaoPct ?? 60);
    res.json({
      custosFixos: roundMoney2(totalFixos),
      margemContribuicaoPct: margem,
      pontoEquilibrio: calcPontoEquilibrio(totalFixos, margem),
      itens: fixos,
    });
  });

  // ── DRE gerencial ─────────────────────────────────────────────────────
  app.get("/api/dre/:year/:month", async (req, res) => {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ message: "Ano/mês inválidos" });
    }
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const receitas = await db.select().from(receitasDia);
    const receita = sumReceitasMes(receitas, year, month);

    const cps = await db.select().from(contasPagar);
    const pagosMes = cps.filter(
      (c) => c.status === "pago" && c.dataPagamento && c.dataPagamento.startsWith(prefix),
    );
    const variaveis = pagosMes
      .filter((c) => c.categoria !== "Pró-labore" && c.categoria !== "DAS")
      .reduce((s, c) => s + parseFloat(String(c.valor)), 0);
    const proLabore = pagosMes
      .filter((c) => c.categoria === "Pró-labore")
      .reduce((s, c) => s + parseFloat(String(c.valor)), 0);
    const das = pagosMes
      .filter((c) => c.categoria === "DAS")
      .reduce((s, c) => s + parseFloat(String(c.valor)), 0);

    const fixos = await db.select().from(custosFixos).where(eq(custosFixos.ativo, true));
    const fixedCost = fixos.reduce((s, c) => s + parseFloat(String(c.valorMensal)), 0);
    const margem = roundMoney2(receita - variaveis);
    const operacional = roundMoney2(margem - fixedCost - proLabore - das);

    // Pró-labore do extrato no mês
    const [conta] = await db.select().from(bancoContas).where(eq(bancoContas.ativo, true)).limit(1);
    const regras = await db.select().from(proLaboreRegras);
    let proLaboreExtrato = 0;
    if (conta) {
      const movs = await db.select().from(bancoMovimentacoes).where(eq(bancoMovimentacoes.contaId, conta.id));
      for (const m of movs) {
        if (m.tipo !== "D" || !m.data.startsWith(prefix)) continue;
        const nat = resolveDebitoNatureza(m.historico, m.prolaboreOverride, regras);
        if (nat.natureza === "pro_labore") proLaboreExtrato += parseFloat(String(m.valor));
      }
    }

    res.json({
      year,
      month,
      receita: roundMoney2(receita),
      custosVariaveis: roundMoney2(variaveis),
      margemContribuicao: margem,
      custosFixos: roundMoney2(fixedCost),
      proLabore: roundMoney2(proLabore + proLaboreExtrato),
      das: roundMoney2(das),
      resultadoOperacional: round2(operacional - proLaboreExtrato),
    });
  });

  // ── Pró-labore ────────────────────────────────────────────────────────
  app.get("/api/pro-labore", async (req, res) => {
    const de = String(req.query.de ?? addDias(hojeBrasil(), -30));
    const ate = String(req.query.ate ?? hojeBrasil());
    const [conta] = await db.select().from(bancoContas).where(eq(bancoContas.ativo, true)).limit(1);
    const regras = await db.select().from(proLaboreRegras).orderBy(asc(proLaboreRegras.ordem));
    if (!conta) return res.json({ itens: [], porSocio: {}, regras });

    const movs = await db
      .select()
      .from(bancoMovimentacoes)
      .where(
        and(
          eq(bancoMovimentacoes.contaId, conta.id),
          eq(bancoMovimentacoes.tipo, "D"),
          gte(bancoMovimentacoes.data, de),
          lte(bancoMovimentacoes.data, ate),
        ),
      )
      .orderBy(desc(bancoMovimentacoes.data));

    const itens = movs.map((m) => {
      const nat = resolveDebitoNatureza(m.historico, m.prolaboreOverride, regras);
      return {
        id: m.id,
        data: m.data,
        historico: m.historico,
        valor: parseFloat(String(m.valor)),
        natureza: nat.natureza,
        socio: nat.socio,
        origem: nat.origem,
        override: m.prolaboreOverride,
        comentario: m.prolaboreComentario,
      };
    });

    const porSocio: Record<string, number> = {};
    for (const i of itens) {
      if (i.natureza === "pro_labore" && i.socio) {
        porSocio[i.socio] = round2((porSocio[i.socio] ?? 0) + i.valor);
      }
    }
    res.json({ itens, porSocio, regras });
  });

  app.get("/api/pro-labore/regras", async (_req, res) => {
    res.json(await db.select().from(proLaboreRegras).orderBy(asc(proLaboreRegras.ordem)));
  });

  app.post("/api/pro-labore/regras", authorize("admin", "gestor"), async (req, res) => {
    const { socio, padrao, ordem, ativo } = req.body ?? {};
    if (!socio || !padrao) return res.status(400).json({ message: "socio e padrao obrigatórios" });
    const [row] = await db
      .insert(proLaboreRegras)
      .values({
        socio: String(socio).toLowerCase(),
        padrao: String(padrao),
        ordem: Number(ordem) || 0,
        ativo: ativo !== false,
      })
      .returning();
    res.status(201).json(row);
  });

  app.put("/api/pro-labore/regras/:id", authorize("admin", "gestor"), async (req, res) => {
    const body = req.body ?? {};
    const [row] = await db
      .update(proLaboreRegras)
      .set({
        ...(body.socio != null ? { socio: String(body.socio).toLowerCase() } : {}),
        ...(body.padrao != null ? { padrao: String(body.padrao) } : {}),
        ...(body.ordem != null ? { ordem: Number(body.ordem) } : {}),
        ...(body.ativo !== undefined ? { ativo: !!body.ativo } : {}),
      })
      .where(eq(proLaboreRegras.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ message: "Não encontrado" });
    res.json(row);
  });

  app.delete("/api/pro-labore/regras/:id", authorize("admin", "gestor"), async (req, res) => {
    await db.delete(proLaboreRegras).where(eq(proLaboreRegras.id, req.params.id));
    res.json({ ok: true });
  });
}
