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
  const [incluirDas, setIncluirDas] = useState(false);
  const [incluirProLabore, setIncluirProLabore] = useState(true);
  const [modal, setModal] = useState<LancamentoEdit | null>(null);
  const [planilhaOpen, setPlanilhaOpen] = useState(false);
  const [saldoInicial, setSaldoInicial] = useState({ data: "", valor: "" });

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
      }>("/api/extrato/parse-csv", file);
      if (!parsed.header) throw new Error("CSV sem header de agência/conta (ou formato não reconhecido)");
      const r = await api.post<{ inseridas: number; total: number }>("/api/extrato/import", {
        agencia: parsed.header.agencia,
        conta: parsed.header.conta,
        nome:
          parsed.formato === "gendo-transacoes"
            ? "Gendo — Transações"
            : `Conta ${parsed.header.agencia}/${parsed.header.conta}`,
        rows: parsed.rows,
        saldoInicialData: saldoInicial.data || undefined,
        saldoInicialValor: saldoInicial.valor ? Number(saldoInicial.valor) : undefined,
        ativar: true,
      });
      return { ...r, formato: parsed.formato, ignoradasNaoRealizadas: parsed.ignoradasNaoRealizadas ?? 0 };
    },
    onSuccess: (r: any) => {
      const extra =
        r.formato === "gendo-transacoes" && r.ignoradasNaoRealizadas
          ? ` · ${r.ignoradasNaoRealizadas} não realizadas ignoradas`
          : "";
      toast.success(`Importadas ${r.inseridas} de ${r.total} linhas${extra}`);
      qc.invalidateQueries({ queryKey: ["fluxo"] });
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
    if (!confirm("Excluir este lançamento?")) return;
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

  if (q.isLoading) return <p className="text-[var(--text-muted)]">Carregando fluxo…</p>;
  if (q.isError) {
    return (
      <div className="text-[var(--red)]">
        Erro ao carregar.{" "}
        <button type="button" className="underline" onClick={() => q.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const d = q.data!;
  const m = d.metas;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm">
        <span className="text-xs uppercase tracking-wide text-[var(--text-muted)] font-medium">
          Faturamento do mês
        </span>
        <span>
          Meta <strong className="text-white ml-1">{format(m.metaFaturamento)}</strong>
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
          Ponto eq.{" "}
          <strong className="ml-1">{m.pontoEquilibrio != null ? format(m.pontoEquilibrio) : "—"}</strong>
        </span>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importMut.isPending}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {importMut.isPending ? "Importando CSV…" : "Importar CSV"}
        </button>
        <button
          type="button"
          onClick={() => setPlanilhaOpen(true)}
          className="rounded-lg border border-[var(--accent)]/50 text-[var(--accent)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
        >
          Importar planilha
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importMut.mutate(f);
            e.target.value = "";
          }}
        />
        <span className="text-[10px] text-[var(--text-muted)] max-w-[10rem] leading-tight">
          Gendo <em>transacoes.csv</em> ou extrato banco
        </span>
        <button
          type="button"
          onClick={() => setModal({ tipo: "receita" })}
          className="rounded-lg border border-[var(--green)]/40 text-[var(--green)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
        >
          + Receita
        </button>
        <button
          type="button"
          onClick={() => setModal({ tipo: "pagar" })}
          className="rounded-lg border border-[var(--red)]/40 text-[var(--red)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
        >
          + Despesa
        </button>
        <button
          type="button"
          onClick={() => setModal({ tipo: "receber" })}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
        >
          + A receber
        </button>
        <button
          type="button"
          onClick={() =>
            api.post("/api/extrato/reconciliar", {}).then((r: any) => {
              toast.success(`${r.matches} conciliadas`);
              refresh();
            })
          }
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
        >
          Reconciliar
        </button>
        {d.ultimaDataExtrato && (
          <span className="text-xs text-[var(--text-muted)] ml-2">
            Extrato até {formatDateBR(d.ultimaDataExtrato)}
          </span>
        )}
        <div className="flex gap-2 ml-auto text-xs items-center">
          <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
            Âncora
            <input
              type="date"
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5"
              value={saldoInicial.data}
              onChange={(e) => setSaldoInicial((s) => ({ ...s, data: e.target.value }))}
            />
            <input
              type="number"
              placeholder="Saldo"
              className="w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5"
              value={saldoInicial.valor}
              onChange={(e) => setSaldoInicial((s) => ({ ...s, valor: e.target.value }))}
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi
          label="Saldo real hoje"
          value={d.saldoRealHoje != null ? format(d.saldoRealHoje) : "— configure âncora"}
          note={d.conta?.nome}
        />
        <Kpi label="A receber 30d" value={format(d.aReceber30)} tone="green" note="recebíveis abertos" />
        <Kpi label="A pagar 30d" value={format(d.aPagar30)} tone="red" />
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={incluirProLabore}
            onChange={(e) => setIncluirProLabore(e.target.checked)}
          />
          Incluir pró-labore no fluxo
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={incluirDas} onChange={(e) => setIncluirDas(e.target.checked)} />
          Incluir DAS no fluxo
        </label>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)] mb-3">
          Saldo real × projetado
        </h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
              <XAxis dataKey="data" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#161b22", border: "1px solid #30363d" }}
                formatter={(v: number) => format(v)}
              />
              <Legend />
              <ReferenceLine
                x={d.hoje.slice(5)}
                stroke="#8b949e"
                strokeDasharray="4 4"
                label={{ value: "hoje", fill: "#8b949e", fontSize: 11 }}
              />
              <Bar dataKey="entradas" name="Entradas" fill="#3fb950" opacity={0.7} />
              <Bar dataKey="saidas" name="Saídas" fill="#f85149" opacity={0.7} />
              <Line
                type="monotone"
                dataKey="saldoReal"
                name="Saldo real"
                stroke="#2f81f7"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="saldoProjetado"
                name="Saldo projetado"
                stroke="#2f81f7"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">
            Lançamentos / compensações
          </h2>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg)]"
              onClick={() => setModal({ tipo: "receita" })}
            >
              + Receita
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg)]"
              onClick={() => setModal({ tipo: "pagar" })}
            >
              + Despesa
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg)]"
              onClick={() => setModal({ tipo: "receber" })}
            >
              + A receber
            </button>
          </div>
        </div>
        <div className="space-y-3 max-h-[28rem] overflow-y-auto">
          {d.dias.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              Nenhum lançamento no período. Use os botões acima para criar.
            </p>
          )}
          {d.dias.map((dia) => (
            <div key={dia.data} className="border-b border-[var(--border)] pb-3 last:border-0">
              <p className="text-sm font-medium mb-1">
                {formatDateBR(dia.data)}{" "}
                <span className="text-[var(--text-muted)] font-normal">{formatWeekday(dia.data)}</span>
              </p>
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
                      <span className="opacity-70 group-hover:opacity-100 flex gap-1 shrink-0">
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-[var(--bg)]"
                          title="Editar"
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
                          className="p-1 rounded hover:bg-[var(--bg)] text-[var(--red)]"
                          title="Excluir"
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
                      <span className="opacity-70 group-hover:opacity-100 flex gap-1 shrink-0">
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-[var(--bg)]"
                          title="Editar"
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
                          className="p-1 rounded hover:bg-[var(--bg)] text-[var(--red)]"
                          title="Excluir"
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
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "green" | "red";
}) {
  const color =
    tone === "green" ? "text-[var(--green)]" : tone === "red" ? "text-[var(--red)]" : "text-white";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`text-2xl mt-1 ${color}`}>{value}</p>
      {note && <p className="text-xs text-[var(--text-muted)] mt-1">{note}</p>}
    </div>
  );
}
