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
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR, formatWeekday } from "@/lib/formatters";
import ReceitaDiaModal from "@/components/receita-dia-modal";

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
  const [receitaOpen, setReceitaOpen] = useState(false);
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
      }>("/api/extrato/parse-csv", file);
      if (!parsed.header) throw new Error("CSV sem header de agência/conta");
      return api.post("/api/extrato/import", {
        agencia: parsed.header.agencia,
        conta: parsed.header.conta,
        nome: "Conta corrente",
        rows: parsed.rows,
        saldoInicialData: saldoInicial.data || undefined,
        saldoInicialValor: saldoInicial.valor ? Number(saldoInicial.valor) : undefined,
      });
    },
    onSuccess: (r: any) => {
      toast.success(`Importadas ${r.inseridas} de ${r.total} linhas`);
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

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
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          Importar Extrato
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
        <button
          type="button"
          onClick={() => setReceitaOpen(true)}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card)]"
        >
          Receita do dia
        </button>
        <button
          type="button"
          onClick={() =>
            api.post("/api/extrato/reconciliar", {}).then((r: any) => {
              toast.success(`${r.matches} conciliadas`);
              qc.invalidateQueries({ queryKey: ["fluxo"] });
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
        <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)] mb-3">
          Próximas compensações
        </h2>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {d.dias.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Nenhuma compensação no período.</p>
          )}
          {d.dias.map((dia) => (
            <div key={dia.data} className="border-b border-[var(--border)] pb-3 last:border-0">
              <p className="text-sm font-medium mb-1">
                {formatDateBR(dia.data)}{" "}
                <span className="text-[var(--text-muted)] font-normal">{formatWeekday(dia.data)}</span>
              </p>
              <ul className="text-sm space-y-0.5">
                {dia.entradas?.map((e: any, i: number) => (
                  <li key={`e${i}`} className="text-[var(--green)]">
                    + {format(e.valor)} · {e.clienteNome}
                    {e.descricao ? ` — ${e.descricao}` : ""}
                  </li>
                ))}
                {dia.saidas?.map((s: any, i: number) => (
                  <li key={`s${i}`} className="text-[var(--red)]">
                    − {format(s.valor)} · {s.descricao}
                    {s.categoria ? ` (${s.categoria})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {receitaOpen && (
        <ReceitaDiaModal
          onClose={() => setReceitaOpen(false)}
          onSaved={() => {
            setReceitaOpen(false);
            qc.invalidateQueries({ queryKey: ["fluxo"] });
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
