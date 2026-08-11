import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
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

const emptyForm = () => ({
  descricao: "",
  valor: "",
  dataVencimento: hojeBrasil(),
  categoria: "Outros",
  recorrencia: "" as "" | "mensal",
  observacoes: "",
});

export default function ContasPagarTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const [aba, setAba] = useState<FiltroAba>("aberto");
  const [editingId, setEditingId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["contas-pagar"],
    queryFn: () => api.get<any[]>("/api/contas-pagar"),
  });
  const [form, setForm] = useState(emptyForm);

  const rows = q.data ?? [];
  const abertas = useMemo(
    () => rows.filter((r) => r.status === "pendente" || r.status === "vencido"),
    [rows],
  );
  const pagas = useMemo(() => rows.filter((r) => r.status === "pago"), [rows]);
  const lista = aba === "aberto" ? abertas : pagas;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["contas-pagar"] });
    qc.invalidateQueries({ queryKey: ["fluxo"] });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function startEdit(r: any) {
    setEditingId(r.id);
    setForm({
      descricao: r.descricao ?? "",
      valor: String(r.valor ?? ""),
      dataVencimento: r.dataVencimento ?? hojeBrasil(),
      categoria: r.categoria || "Outros",
      recorrencia: r.recorrencia === "mensal" ? "mensal" : "",
      observacoes: r.observacoes ?? "",
    });
    setAba(r.status === "pago" ? "pagas" : "aberto");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        descricao: form.descricao,
        valor: Number(form.valor),
        dataVencimento: form.dataVencimento,
        categoria: form.categoria,
        recorrencia: form.recorrencia || null,
        observacoes: form.observacoes || null,
      };
      if (editingId) return api.patch(`/api/contas-pagar/${editingId}`, body);
      return api.post("/api/contas-pagar", body);
    },
    onSuccess: () => {
      toast.success(editingId ? "Conta atualizada" : "Conta criada");
      resetForm();
      if (!editingId) setAba("aberto");
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function pagar(r: any) {
    try {
      await api.patch(`/api/contas-pagar/${r.id}`, {
        status: "pago",
        dataPagamento: hojeBrasil(),
      });
      toast.success(
        r.recorrencia === "mensal"
          ? "Paga — próxima parcela mensal criada"
          : "Marcada como paga",
      );
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function tornarMensal(r: any) {
    try {
      await api.patch(`/api/contas-pagar/${r.id}`, { recorrencia: "mensal" });
      toast.success("Agora é mensal (gera próxima ao pagar)");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function removerMensal(r: any) {
    try {
      await api.patch(`/api/contas-pagar/${r.id}`, { recorrencia: null });
      toast.success("Recorrência removida");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function excluir(r: any) {
    if (!confirm(`Excluir “${r.descricao}”?`)) return;
    try {
      await api.delete(`/api/contas-pagar/${r.id}`);
      toast.success("Excluída");
      if (editingId === r.id) resetForm();
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm text-white">
            {editingId ? "Editar conta a pagar" : "Nova conta a pagar"}
          </h3>
          {editingId && (
            <button
              type="button"
              className="text-xs text-[var(--text-muted)] hover:text-white"
              onClick={resetForm}
            >
              Cancelar edição
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="min-w-[12rem] flex-1">
            <label className="text-xs text-[var(--text-muted)]">Descrição</label>
            <input
              required
              className="block mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex.: Aluguel sala"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)]">Valor</label>
            <input
              type="number"
              step="0.01"
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
              onChange={(e) => setForm({ ...form, recorrencia: e.target.value as "" | "mensal" })}
            >
              <option value="">Única</option>
              <option value="mensal">Mensal</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {save.isPending ? "Salvando…" : editingId ? "Salvar" : "Adicionar"}
          </button>
        </div>
        {form.recorrencia === "mensal" && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Mensal: ao marcar como paga, o sistema cria automaticamente a próxima parcela no mês
            seguinte (ex.: aluguel).
          </p>
        )}
        <div>
          <label className="text-xs text-[var(--text-muted)]">Observações</label>
          <input
            className="block mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            placeholder="Opcional"
          />
        </div>
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
              <th className="p-3"></th>
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
              <tr
                key={r.id}
                className={`border-t border-[var(--border)] ${
                  editingId === r.id ? "bg-[var(--accent)]/5" : ""
                }`}
              >
                <td className="p-3">
                  {r.descricao}
                  {r.recorrencia === "mensal" && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--accent)]/40 text-[var(--accent)]">
                      mensal
                    </span>
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
                <td className="p-3">
                  <div className="flex flex-wrap gap-2 justify-end items-center">
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-[var(--bg)] text-[var(--text-muted)] hover:text-white"
                      title="Editar"
                      onClick={() => startEdit(r)}
                    >
                      <Pencil size={14} />
                    </button>
                    {(r.status === "pendente" || r.status === "vencido") && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-[var(--accent)]"
                          onClick={() => pagar(r)}
                        >
                          Pagar
                        </button>
                        {r.recorrencia !== "mensal" ? (
                          <button
                            type="button"
                            className="text-xs text-[var(--text-muted)] hover:text-white"
                            title="Repete todo mês ao pagar"
                            onClick={() => tornarMensal(r)}
                          >
                            Tornar mensal
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs text-[var(--text-muted)] hover:text-white"
                            onClick={() => removerMensal(r)}
                          >
                            Só única
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-[var(--bg)] text-[var(--red)]"
                      title="Excluir"
                      onClick={() => excluir(r)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
