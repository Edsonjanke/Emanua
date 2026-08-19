import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";

interface LinhaDre {
  label: string;
  value: number;
  tone?: string;
  bold?: boolean;
}

/**
 * As linhas "(−) Custos…" já carregam o sinal no próprio rótulo, então elas
 * mostram o valor absoluto. As linhas de RESULTADO (Margem de contribuição e
 * Resultado operacional) não têm prefixo — e a versão anterior aplicava
 * `Math.abs()` nelas também, com um ternário morto que devolvia "" nos três
 * ramos. Um prejuízo de R$ 1.373,65 aparecia como "R$ 1.373,65" em cor neutra:
 * o mês fechava no vermelho e o painel lia lucro.
 */
function ehResultado(r: LinhaDre): boolean {
  return !r.tone;
}

function valorDaLinha(r: LinhaDre, format: (n: number) => string): string {
  const texto = format(Math.abs(r.value));
  return ehResultado(r) && r.value < 0 ? `− ${texto}` : texto;
}

function corDaLinha(r: LinhaDre): string {
  if (r.tone === "green") return "text-[var(--green)]";
  if (r.tone === "red") return "text-[var(--red-text)]";
  if (r.value < 0) return "text-[var(--red-text)]";
  if (r.value > 0) return "text-[var(--green)]";
  return "text-[var(--text)]";
}

export default function DreTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { format } = useMoney();

  const q = useQuery({
    queryKey: ["dre", year, month],
    queryFn: () => api.get<any>(`/api/dre/${year}/${month}`),
  });

  const rows = q.data
    ? [
        { label: "Receita (receitas do dia)", value: q.data.receita, tone: "green" },
        { label: "(−) Custos variáveis", value: -q.data.custosVariaveis, tone: "red" },
        { label: "Margem de contribuição", value: q.data.margemContribuicao, bold: true },
        { label: "(−) Custos fixos", value: -q.data.custosFixos, tone: "red" },
        { label: "(−) Pró-labore", value: -q.data.proLabore, tone: "red" },
        { label: "(−) DAS (Simples Nacional)", value: -q.data.das, tone: "red" },
        { label: "Resultado operacional", value: q.data.resultadoOperacional, bold: true },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-[var(--text-muted)]">Ano</label>
          <input
            type="number"
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Mês</label>
          <select
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 max-w-lg">
        <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)] mb-3">
          DRE gerencial {String(month).padStart(2, "0")}/{year}
        </h2>
        {q.isLoading && <p className="text-[var(--text-muted)]">Carregando…</p>}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.label}
              className={`flex justify-between text-sm ${r.bold ? "pt-2 border-t border-[var(--border)] font-medium" : ""}`}
            >
              <span className="text-[var(--text-muted)]">{r.label}</span>
              <span className={`tabular-nums ${corDaLinha(r)}`}>{valorDaLinha(r, format)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
