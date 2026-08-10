import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";

interface ParseResult {
  sheetName: string;
  rows: any[];
  preview: any[];
  erros: string[];
  resumo: {
    total: number;
    entradas: number;
    saidas: number;
    receitaOperacional: number;
    porConta: Record<string, number>;
    porCategoria: Record<string, number>;
  };
}

export default function ImportPlanilhaModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { format } = useMoney();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState({
    extrato: true,
    receitas: true,
    despesas: true,
    skipTransferenciasInternas: true,
  });

  async function onFile(file: File) {
    setBusy(true);
    try {
      const data = await api.upload<ParseResult>("/api/planilha/parse", file);
      setParsed(data);
      if (data.erros?.length) toast.message(`${data.erros.length} linhas com aviso`);
      toast.success(`${data.resumo.total} movimentações lidas`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function importar() {
    if (!parsed?.rows?.length) return;
    setBusy(true);
    try {
      const r = await api.post<any>("/api/planilha/import", {
        rows: parsed.rows,
        ...opts,
      });
      toast.success(
        `Extrato +${r.extratoInseridos} · Receitas +${r.receitasInseridas} · Despesas +${r.despesasInseridas}`,
      );
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 space-y-4"
      >
        <div>
          <h3 className="text-lg text-white">Importar planilha de entradas/saídas</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Formato XLSX com aba <em>Movimentações</em> (Data, Conta, Tipo, Descrição, Categoria,
            Entrada/Saída…). Ex.: planilha jun–ago 2026.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy && !parsed ? "Lendo…" : "Escolher arquivo .xlsx"}
        </button>

        {parsed && (
          <>
            <div className="grid sm:grid-cols-4 gap-2 text-sm">
              <Stat label="Total" value={String(parsed.resumo.total)} />
              <Stat label="Entradas" value={String(parsed.resumo.entradas)} tone="green" />
              <Stat label="Saídas" value={String(parsed.resumo.saidas)} tone="red" />
              <Stat label="Receita operacional" value={String(parsed.resumo.receitaOperacional)} />
            </div>

            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <p>
                Contas:{" "}
                {Object.entries(parsed.resumo.porConta)
                  .map(([k, v]) => `${k} (${v})`)
                  .join(" · ")}
              </p>
              <p>Aba: {parsed.sheetName}</p>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={opts.extrato}
                  onChange={(e) => setOpts({ ...opts, extrato: e.target.checked })}
                />
                Extrato (saldo do fluxo)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={opts.receitas}
                  onChange={(e) => setOpts({ ...opts, receitas: e.target.checked })}
                />
                Receitas operacionais
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={opts.despesas}
                  onChange={(e) => setOpts({ ...opts, despesas: e.target.checked })}
                />
                Saídas como contas pagas
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={opts.skipTransferenciasInternas}
                  onChange={(e) => setOpts({ ...opts, skipTransferenciasInternas: e.target.checked })}
                />
                Ignorar transferências internas em receita/despesa
              </label>
            </div>

            <div className="rounded-lg border border-[var(--border)] overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="text-[var(--text-muted)] text-left sticky top-0 bg-[var(--bg-elevated)]">
                  <tr>
                    <th className="p-2">Data</th>
                    <th>Conta</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(parsed.preview ?? parsed.rows.slice(0, 30)).map((r) => (
                    <tr key={r.dedupKey} className="border-t border-[var(--border)]">
                      <td className="p-2 whitespace-nowrap">{formatDateBR(r.data)}</td>
                      <td>{r.conta}</td>
                      <td className={r.tipo === "Entrada" ? "text-[var(--green)]" : "text-[var(--red)]"}>
                        {r.tipo}
                      </td>
                      <td className="max-w-[220px] truncate">{r.descricao}</td>
                      <td>{r.categoria}</td>
                      <td>
                        {format(r.tipo === "Entrada" ? r.entrada : r.saida)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.rows.length > 30 && (
              <p className="text-xs text-[var(--text-muted)]">
                Preview das 30 primeiras · {parsed.rows.length} no total serão importadas
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-[var(--text-muted)]">
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !parsed?.rows?.length}
            onClick={importar}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Importando…" : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color =
    tone === "green" ? "text-[var(--green)]" : tone === "red" ? "text-[var(--red)]" : "text-white";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <p className="text-[10px] uppercase text-[var(--text-muted)]">{label}</p>
      <p className={`text-lg ${color}`}>{value}</p>
    </div>
  );
}
