import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR, formatWeekday } from "@/lib/formatters";
import FluxoLancamentoModal, {
  type LancamentoEdit,
  type LancamentoTipo,
} from "@/components/fluxo-lancamento-modal";
import ImportPlanilhaModal from "@/components/import-planilha-modal";

interface FluxoData {
  hoje: string;
  saldoRealHoje: number | null;
  saldoProjetadoHoje?: number | null;
  ultimaDataExtrato: string | null;
  aReceber30: number;
  aPagar30: number;
  conta: { nome: string } | null;
  serie: any[];
  dias: any[];
  metas: {
    metaFaturamento: number;
    realizado: number;
    projecao: number;
    minimo: number;
    pontoEquilibrio: number | null;
  };
}

export default function FluxoTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const contasFileRef = useRef<HTMLInputElement>(null);
  const [incluirDas, setIncluirDas] = useState(false);
  const [incluirProLabore, setIncluirProLabore] = useState(true);
  const [modal, setModal] = useState<LancamentoEdit | null>(null);
  const [planilhaOpen, setPlanilhaOpen] = useState(false);
  const [saldoInicial, setSaldoInicial] = useState({ data: "", valor: "" });
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const q = useQuery({
    queryKey: ["fluxo", incluirDas, incluirProLabore],
    queryFn: () =>
      api.get<FluxoData>(
        `/api/financeiro/fluxo?incluirDas=${incluirDas ? 1 : 0}&incluirProLabore=${incluirProLabore ? 1 : 0}`,
      ),
  });

  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const parsed = await api.upload<{
        header: { agencia: string; conta: string } | null;
        rows: any[];
        erros: string[];
        formato?: string;
        ignoradasNaoRealizadas?: number;
        titular?: string | null;
        saldoExtrato?: { data: string | null; valor: number } | null;
      }>("/api/extrato/parse-csv", file);
      if (!parsed.header) {
        throw new Error(
          parsed.erros?.[0] || "Extrato sem conta (CSV/OFX não reconhecido)",
        );
      }
      const nomeConta =
        parsed.formato === "gendo-transacoes"
          ? "Gendo — Transações"
          : parsed.formato === "ofx" || parsed.formato === "conta-titulares"
            ? parsed.titular
              ? `Conta ${parsed.header.conta} · ${parsed.titular.slice(0, 40)}`
              : `Conta ${parsed.header.conta}`
            : `Conta ${parsed.header.agencia}/${parsed.header.conta}`;
      const ancoraData = saldoInicial.data || parsed.saldoExtrato?.data || undefined;
      const ancoraValor = saldoInicial.valor
        ? Number(saldoInicial.valor)
        : parsed.saldoExtrato?.valor != null
          ? parsed.saldoExtrato.valor
          : undefined;
      const r = await api.post<{
        inseridas: number;
        total: number;
        receitasInseridas?: number;
        despesasInseridas?: number;
      }>("/api/extrato/import", {
        agencia: parsed.header.agencia,
        conta: parsed.header.conta,
        nome: nomeConta,
        rows: parsed.rows,
        formato: parsed.formato,
        saldoInicialData: ancoraData,
        saldoInicialValor: ancoraValor,
        ativar: true,
      });
      return {
        ...r,
        formato: parsed.formato,
        ignoradasNaoRealizadas: parsed.ignoradasNaoRealizadas ?? 0,
        rowsLidas: parsed.rows.length,
        saldoAplicado: ancoraValor ?? null,
      };
    },
    onSuccess: (r: any) => {
      const parts = [`Extrato +${r.inseridas}`];
      if (r.receitasInseridas) parts.push(`receitas +${r.receitasInseridas}`);
      if (r.despesasInseridas) parts.push(`despesas +${r.despesasInseridas}`);
      if (r.saldoAplicado != null) parts.push(`saldo ${format(r.saldoAplicado)}`);
      const extra =
        r.formato === "gendo-transacoes" && r.ignoradasNaoRealizadas
          ? ` · ${r.ignoradasNaoRealizadas} não realizadas ignoradas`
          : "";
      toast.success(`${parts.join(" · ")}${extra}`);
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const importContasMut = useMutation({
    mutationFn: async (file: File) => {
      const parsed = await api.upload<{
        rows: any[];
        erros: string[];
        resumo: { total: number; pagas: number; pendentes: number; vencidas: number };
      }>("/api/contas-pagar/parse-csv", file);
      if (!parsed.rows?.length) throw new Error(parsed.erros?.[0] || "Nenhuma conta a pagar no CSV");
      const r = await api.post<{ inseridas: number; duplicadas: number; total: number }>(
        "/api/contas-pagar/import-csv",
        { rows: parsed.rows },
      );
      return { ...r, resumo: parsed.resumo };
    },
    onSuccess: (r: any) => {
      toast.success(
        `Contas a pagar +${r.inseridas}` +
          (r.duplicadas ? ` · ${r.duplicadas} já existiam` : "") +
          (r.resumo ? ` (${r.resumo.pendentes} pend. · ${r.resumo.pagas} pagas)` : ""),
      );
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["fluxo"] });
    qc.invalidateQueries({ queryKey: ["receitas-dia"] });
    qc.invalidateQueries({ queryKey: ["contas-pagar"] });
    qc.invalidateQueries({ queryKey: ["recebiveis"] });
    qc.invalidateQueries({ queryKey: ["metas"] });
  }

  async function removeItem(tipo: LancamentoTipo, id: string) {
    if (!confirm("Excluir este lançamento do caixa? Esta ação não pode ser desfeita.")) return;
    try {
      if (tipo === "receita") await api.delete(`/api/receitas-dia/${id}`);
      else if (tipo === "pagar") await api.delete(`/api/contas-pagar/${id}`);
      else await api.delete(`/api/recebiveis/${id}`);
      toast.success("Excluído");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const chartData = useMemo(() => {
    const data = q.data;
    if (!data) return [];
    return data.serie.map((p) => ({
      data: p.data.slice(5),
      full: p.data,
      saldoReal: p.saldoReal ?? null,
      saldoProjetado: p.saldoProjetado ?? null,
      entradas: p.entradasReal ?? p.entradasPrevistas ?? 0,
      saidas: p.saidasEmpresaReal ?? p.saidasPrevistas ?? p.saidasReal ?? 0,
    }));
  }, [q.data]);

  if (q.isLoading) return <p className="text-[var(--text-muted)]">Carregando o fluxo de caixa…</p>;
  if (q.isError) {
    return (
      <div className="text-[var(--red)]">
        Não foi possível carregar o fluxo.{" "}
        <button type="button" className="underline" onClick={() => q.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const d = q.data!;
  const m = d.metas;

  return (
    <div className="flex flex-col gap-8">
      {/* Today band: cash KPIs + daily creates + lançamentos */}
      <section className="flex flex-col gap-3" aria-label="Caixa de hoje">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Kpi
            label="Saldo real hoje"
            value={d.saldoRealHoje != null ? format(d.saldoRealHoje) : "Defina o saldo inicial"}
            note={d.conta?.nome ?? "Use a data e o valor em Importações"}
            size="lead"
          />
          <Kpi
            label="Saldo projetado"
            value={
              d.saldoProjetadoHoje != null
                ? format(d.saldoProjetadoHoje)
                : d.saldoRealHoje != null
                  ? format(d.saldoRealHoje)
                  : "—"
            }
            tone="accent"
            note="Saldo real + entradas e saídas previstas para hoje"
            size="lead"
          />
          <Kpi
            label="A receber (30 dias)"
            value={format(d.aReceber30)}
            tone="green"
            note="Valores ainda não recebidos"
            size="compact"
          />
          <Kpi label="A pagar (30 dias)" value={format(d.aPagar30)} tone="red" note="Contas ainda não pagas" size="compact" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModal({ tipo: "receita" })}
            className="rounded-lg border border-[var(--green)]/40 bg-[var(--bg-card)] text-[var(--green)] px-4 py-2 text-sm hover:bg-[var(--sage)]/50"
          >
            + Receita do dia
          </button>
          <button
            type="button"
            onClick={() => setModal({ tipo: "pagar" })}
            className="rounded-lg border border-[var(--red)]/40 bg-[var(--bg-card)] text-[var(--red)] px-4 py-2 text-sm hover:bg-[var(--bg)]"
          >
            + Conta a pagar
          </button>
          <button
            type="button"
            onClick={() => setModal({ tipo: "receber" })}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm hover:bg-[var(--sage)]/40"
          >
            + Valor a receber
          </button>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-medium text-[var(--text)] mb-3">Lançamentos do caixa</h2>
          <div className="space-y-3 max-h-[28rem] overflow-y-auto">
            {d.dias.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">
                Ainda não há lançamentos neste período. Comece com <strong>+ Receita do dia</strong> ou{" "}
                <strong>+ Conta a pagar</strong>.
              </p>
            )}
            {d.dias.map((dia) => (
              <div key={dia.data} className="border-b border-[var(--border)] pb-3 last:border-0">
                <div className="flex items-center gap-2 flex-wrap text-sm mb-1">
                  <p className="font-medium">
                    {formatDateBR(dia.data)}{" "}
                    <span className="text-[var(--text-muted)] font-normal">{formatWeekday(dia.data)}</span>
                  </p>
                  {(dia.isHoje || dia.data === d.hoje) && (
                    <span className="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--accent)]/40 text-[var(--accent)]">
                      hoje
                    </span>
                  )}
                  {dia.totalEntradas > 0 && (
                    <span className="tabular-nums text-[var(--green)] text-xs">+{format(dia.totalEntradas)}</span>
                  )}
                  {dia.totalSaidas > 0 && (
                    <span className="tabular-nums text-[var(--red)] text-xs">−{format(dia.totalSaidas)}</span>
                  )}
                  {dia.saldoProjetado != null && (
                    <span
                      className={`ml-auto tabular-nums text-xs ${
                        dia.saldoProjetado < 0 ? "text-[var(--red)] font-semibold" : "text-[var(--accent)]"
                      }`}
                    >
                      {dia.isPassado ? "Saldo" : "Projetado"} {format(dia.saldoProjetado)}
                    </span>
                  )}
                </div>
                <ul className="text-sm space-y-1">
                  {dia.entradas?.map((e: any) => (
                    <li key={e.id || `e-${e.clienteNome}-${e.valor}`} className="flex items-center gap-2 group">
                      <span className="text-[var(--green)] flex-1 min-w-0">
                        + {format(e.valor)} · {e.clienteNome}
                        {e.descricao ? ` — ${e.descricao}` : ""}
                        {e.tipo === "receita" && (
                          <span className="text-[var(--text-muted)] text-xs ml-1">receita</span>
                        )}
                        {e.tipo === "recebivel" && (
                          <span className="text-[var(--text-muted)] text-xs ml-1">a receber</span>
                        )}
                      </span>
                      {e.id && e.tipo && (
                        <span className="opacity-70 group-hover:opacity-100 flex gap-0.5 shrink-0">
                          <button
                            type="button"
                            className="min-h-10 min-w-10 inline-flex items-center justify-center rounded hover:bg-[var(--bg)]"
                            title="Editar"
                            aria-label="Editar"
                            onClick={() =>
                              setModal({
                                id: e.id,
                                tipo: e.tipo === "recebivel" ? "receber" : "receita",
                                data: e.data || dia.data,
                                dataVencimento: e.dataVencimento || dia.data,
                                valor: e.valor,
                                forma: e.forma,
                                observacao: e.observacao || e.descricao,
                                descricao: e.descricao,
                                clienteNome: e.clienteNome,
                                observacoes: e.observacoes,
                                status: e.status,
                              })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="min-h-10 min-w-10 inline-flex items-center justify-center rounded hover:bg-[var(--bg)] text-[var(--red)]"
                            title="Excluir"
                            aria-label="Excluir"
                            onClick={() =>
                              removeItem(e.tipo === "recebivel" ? "receber" : "receita", e.id)
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                  {dia.saidas?.map((s: any) => (
                    <li key={s.id || `s-${s.descricao}-${s.valor}`} className="flex items-center gap-2 group">
                      <span className="text-[var(--red)] flex-1 min-w-0">
                        − {format(s.valor)} · {s.descricao}
                        {s.categoria ? ` (${s.categoria})` : ""}
                      </span>
                      {s.id && (
                        <span className="opacity-70 group-hover:opacity-100 flex gap-0.5 shrink-0">
                          <button
                            type="button"
                            className="min-h-10 min-w-10 inline-flex items-center justify-center rounded hover:bg-[var(--bg)]"
                            title="Editar"
                            aria-label="Editar"
                            onClick={() =>
                              setModal({
                                id: s.id,
                                tipo: "pagar",
                                data: s.dataVencimento || dia.data,
                                dataVencimento: s.dataVencimento || dia.data,
                                valor: s.valor,
                                descricao: s.descricao,
                                categoria: s.categoria,
                                recorrencia: s.recorrencia,
                                observacoes: s.observacoes,
                                status: s.status,
                              })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="min-h-10 min-w-10 inline-flex items-center justify-center rounded hover:bg-[var(--bg)] text-[var(--red)]"
                            title="Excluir"
                            aria-label="Excluir"
                            onClick={() => removeItem("pagar", s.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Analysis band */}
      <section className="flex flex-col gap-3" aria-label="Análise">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium text-[var(--text)]">Saldo real × projetado</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <label
                className="flex items-center gap-2 cursor-pointer text-[var(--text-muted)]"
                title="Inclui retiradas pessoais dos sócios no gráfico"
              >
                <input
                  type="checkbox"
                  checked={incluirProLabore}
                  onChange={(e) => setIncluirProLabore(e.target.checked)}
                />
                Incluir pró-labore
              </label>
              <label
                className="flex items-center gap-2 cursor-pointer text-[var(--text-muted)]"
                title="Inclui o DAS (imposto do Simples Nacional) no gráfico"
              >
                <input type="checkbox" checked={incluirDas} onChange={(e) => setIncluirDas(e.target.checked)} />
                Incluir DAS (Simples)
              </label>
            </div>
          </div>
          <div className="h-72 md:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid stroke="#bed3b2" strokeDasharray="3 3" />
                <XAxis dataKey="data" tick={{ fill: "#516335", fontSize: 11 }} />
                <YAxis tick={{ fill: "#516335", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #bed3b2", color: "#172416" }}
                  formatter={(v: number) => format(v)}
                />
                <Legend />
                <ReferenceLine
                  x={d.hoje.slice(5)}
                  stroke="#516335"
                  strokeDasharray="4 4"
                  label={{ value: "hoje", fill: "#516335", fontSize: 11 }}
                />
                <Bar dataKey="entradas" name="Entradas" fill="#85ad61" opacity={0.8} />
                <Bar dataKey="saidas" name="Saídas" fill="#c45c52" opacity={0.8} />
                <Line
                  type="monotone"
                  dataKey="saldoReal"
                  name="Saldo real"
                  stroke="#3d5f3b"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="saldoProjetado"
                  name="Saldo projetado"
                  stroke="#559265"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm">
          <span className="text-xs text-[var(--text-muted)] font-medium">Faturamento do mês</span>
          <span>
            Meta <strong className="text-[var(--text)] ml-1">{format(m.metaFaturamento)}</strong>
          </span>
          <span>
            Projeção <strong className="text-[var(--accent)] ml-1">{format(m.projecao)}</strong>
          </span>
          <span>
            Realizado <strong className="text-[var(--green)] ml-1">{format(m.realizado)}</strong>
          </span>
          <span>
            Mínimo <strong className="ml-1">{format(m.minimo)}</strong>
          </span>
          <span>
            Ponto de equilíbrio{" "}
            <strong className="ml-1">{m.pontoEquilibrio != null ? format(m.pontoEquilibrio) : "—"}</strong>
          </span>
        </div>
      </section>

      {/* Rare tools: imports / reconcile / âncora */}
      <section className="flex flex-col gap-2" aria-label="Importações e conciliação">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importMut.isPending}
              title="CSV/OFX do banco ou Gendo transacoes.csv"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {importMut.isPending ? "Importando extrato…" : "Importar extrato"}
            </button>
            <button
              type="button"
              onClick={() => setPlanilhaOpen(true)}
              title="Planilha XLSX de entradas e saídas"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
            >
              Importar planilha
            </button>
            <button
              type="button"
              onClick={() => contasFileRef.current?.click()}
              disabled={importContasMut.isPending}
              title="Importa contas do Gendo (transacoes_contas.csv)"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {importContasMut.isPending ? "Importando contas…" : "Importar contas a pagar"}
            </button>
            <button
              type="button"
              title="Associa lançamentos do extrato com receitas e despesas"
              disabled={reconcileBusy}
              onClick={async () => {
                setReconcileBusy(true);
                try {
                  const r: any = await api.post("/api/extrato/reconciliar", {});
                  toast.success(
                    r.matches
                      ? `${r.matches} lançamento(ns) conciliado(s) com o extrato`
                      : "Nenhum lançamento novo para conciliar",
                  );
                  refresh();
                } catch (e: any) {
                  toast.error(e.message || "Não foi possível conciliar o extrato");
                } finally {
                  setReconcileBusy(false);
                }
              }}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {reconcileBusy ? "Conciliando…" : "Conciliar extrato"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.ofx,text/csv,application/x-ofx,application/ofx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importMut.mutate(f);
                e.target.value = "";
              }}
            />
            <input
              ref={contasFileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importContasMut.mutate(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2 items-end text-xs text-[var(--text-muted)]">
            <label className="flex flex-col gap-1">
              <span title="Data e valor do saldo bancário a partir do qual o extrato começa">
                Saldo inicial (âncora)
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Data do saldo inicial"
                  className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1"
                  value={saldoInicial.data}
                  onChange={(e) => setSaldoInicial((s) => ({ ...s, data: e.target.value }))}
                />
                <input
                  type="number"
                  placeholder="R$"
                  aria-label="Valor do saldo inicial"
                  className="w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1"
                  value={saldoInicial.valor}
                  onChange={(e) => setSaldoInicial((s) => ({ ...s, valor: e.target.value }))}
                />
              </span>
            </label>
            {d.ultimaDataExtrato && (
              <span>Último extrato: {formatDateBR(d.ultimaDataExtrato)}</span>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] leading-snug">
          Extrato: OFX · Conta/Titulares CSV · Viacredi CSV · Gendo <em>transacoes.csv</em> · Contas
          a pagar: <em>transacoes_contas.csv</em>
        </p>
      </section>

      {modal && (
        <FluxoLancamentoModal
          initial={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {planilhaOpen && (
        <ImportPlanilhaModal
          onClose={() => setPlanilhaOpen(false)}
          onSaved={() => {
            setPlanilhaOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
  size = "lead",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "green" | "red" | "accent";
  size?: "lead" | "compact";
}) {
  const color =
    tone === "green"
      ? "text-[var(--green)]"
      : tone === "red"
        ? "text-[var(--red)]"
        : tone === "accent"
          ? "text-[var(--accent)]"
          : "text-[var(--text)]";
  const pad = size === "compact" ? "px-4 py-3" : "p-4";
  const valueSize = size === "compact" ? "text-xl" : "text-3xl";
  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg-card)] ${pad}`}>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`${valueSize} mt-1 tabular-nums ${color}`}>{value}</p>
      {note && <p className="text-xs text-[var(--text-muted)] mt-1">{note}</p>}
    </div>
  );
}
