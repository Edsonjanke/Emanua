import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";
import { hojeBrasil } from "@/lib/date";

const CATEGORIAS_PAGAR = [
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

type FiltroAba = "aberto" | "pagas";

export default function ContasPagarTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const [aba, setAba] = useState<FiltroAba>("aberto");
  const q = useQuery({
    queryKey: ["contas-pagar"],
    queryFn: () => api.get<any[]>("/api/contas-pagar"),
  });
  const [form, setForm] = useState({
    descricao: "",
    valor: "",
    dataVencimento: hojeBrasil(),
    categoria: "Outros",
    recorrencia: "" as "" | "mensal",
  });

  const rows = q.data ?? [];
  const abertas = useMemo(
    () => rows.filter((r) => r.status === "pendente" || r.status === "vencido"),
    [rows],
  );
  const pagas = useMemo(() => rows.filter((r) => r.status === "pago"), [rows]);
  const lista = aba === "aberto" ? abertas : pagas;

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/contas-pagar", {
        descricao: form.descricao,
        valor: Number(form.valor),
        dataVencimento: form.dataVencimento,
        categoria: form.categoria,
        recorrencia: form.recorrencia || null,
      }),
    onSuccess: () => {
      toast.success("Conta criada");
      setForm({
        descricao: "",
        valor: "",
        dataVencimento: hojeBrasil(),
        categoria: "Outros",
        recorrencia: "",
      });
      setAba("aberto");
      qc.invalidateQueries({ queryKey: ["contas-pagar"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["contas-pagar"] });
    qc.invalidateQueries({ queryKey: ["fluxo"] });
  }

  return (
    <div className="space-y-4">
      <form
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-wrap gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <label className="text-xs text-[var(--text-muted)]">Descrição</label>
          <input
            required
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Valor</label>
          <input
            type="number"
            required
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-28"
            value={form.valor}
            onChange={(e) => setForm({ ...form, valor: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Vencimento</label>
          <input
            type="date"
            required
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={form.dataVencimento}
            onChange={(e) => setForm({ ...form, dataVencimento: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Categoria</label>
          <select
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={form.categoria}
            onChange={(e) => setForm({ ...form, categoria: e.target.value })}
          >
            {CATEGORIAS_PAGAR.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Recorrência</label>
          <select
            className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={form.recorrencia}
            onChange={(e) => setForm({ ...form, recorrencia: e.target.value as any })}
          >
            <option value="">Única</option>
            <option value="mensal">Mensal</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">
          Adicionar
        </button>
      </form>

      <div className="flex gap-1 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => setAba("aberto")}
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            aba === "aberto"
              ? "border-[var(--accent)] text-white"
              : "border-transparent text-[var(--text-muted)] hover:text-white"
          }`}
        >
          Em aberto
          <span className="ml-1.5 text-xs text-[var(--text-muted)]">({abertas.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setAba("pagas")}
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            aba === "pagas"
              ? "border-[var(--accent)] text-white"
              : "border-transparent text-[var(--text-muted)] hover:text-white"
          }`}
        >
          Pagas
          <span className="ml-1.5 text-xs text-[var(--text-muted)]">({pagas.length})</span>
        </button>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[var(--text-muted)] text-left">
            <tr>
              <th className="p-3">Descrição</th>
              <th>Categoria</th>
              <th>Vencimento</th>
              {aba === "pagas" && <th>Pagamento</th>}
              <th>Valor</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr>
                <td
                  colSpan={aba === "pagas" ? 7 : 6}
                  className="p-6 text-center text-[var(--text-muted)]"
                >
                  {aba === "aberto" ? "Nenhuma conta em aberto." : "Nenhuma conta paga."}
                </td>
              </tr>
            )}
            {lista.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="p-3">
                  {r.descricao}
                  {r.recorrencia === "mensal" && (
                    <span className="ml-2 text-xs text-[var(--text-muted)]">mensal</span>
                  )}
                </td>
                <td>{r.categoria}</td>
                <td>{formatDateBR(r.dataVencimento)}</td>
                {aba === "pagas" && (
                  <td>{r.dataPagamento ? formatDateBR(r.dataPagamento) : "—"}</td>
                )}
                <td className="text-[var(--red)]">{format(Number(r.valor))}</td>
                <td>
                  <span
                    className={
                      r.status === "vencido"
                        ? "text-[var(--red)]"
                        : r.status === "pago"
                          ? "text-[var(--green)]"
                          : ""
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="p-3 space-x-2">
                  {(r.status === "pendente" || r.status === "vencido") && (
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)]"
                      onClick={() =>
                        api
                          .patch(`/api/contas-pagar/${r.id}`, {
                            status: "pago",
                            dataPagamento: hojeBrasil(),
                          })
                          .then(() => {
                            toast.success("Marcada como paga");
                            refresh();
                          })
                      }
                    >
                      Pagar
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs text-[var(--red)]"
                    onClick={() =>
                      api.delete(`/api/contas-pagar/${r.id}`).then(() => {
                        refresh();
                      })
                    }
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
