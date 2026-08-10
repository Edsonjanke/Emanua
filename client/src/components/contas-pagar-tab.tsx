import { useState } from "react";
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

export default function ContasPagarTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
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
      qc.invalidateQueries({ queryKey: ["contas-pagar"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

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

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[var(--text-muted)] text-left">
            <tr>
              <th className="p-3">Descrição</th>
              <th>Categoria</th>
              <th>Vencimento</th>
              <th>Valor</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="p-3">
                  {r.descricao}
                  {r.recorrencia === "mensal" && (
                    <span className="ml-2 text-xs text-[var(--text-muted)]">mensal</span>
                  )}
                </td>
                <td>{r.categoria}</td>
                <td>{formatDateBR(r.dataVencimento)}</td>
                <td className="text-[var(--red)]">{format(Number(r.valor))}</td>
                <td>{r.status}</td>
                <td className="p-3 space-x-2">
                  {(r.status === "pendente" || r.status === "vencido") && (
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)]"
                      onClick={() =>
                        api.patch(`/api/contas-pagar/${r.id}`, { status: "pago" }).then(() => {
                          qc.invalidateQueries({ queryKey: ["contas-pagar"] });
                          qc.invalidateQueries({ queryKey: ["fluxo"] });
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
                        qc.invalidateQueries({ queryKey: ["contas-pagar"] });
                        qc.invalidateQueries({ queryKey: ["fluxo"] });
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
