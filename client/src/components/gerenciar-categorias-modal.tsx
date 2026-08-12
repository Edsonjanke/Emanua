import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useCategorias, type Categoria } from "@/lib/use-categorias";

export default function GerenciarCategoriasModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useCategorias({ todos: true });
  const [novoNome, setNovoNome] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["categorias"] });
    qc.invalidateQueries({ queryKey: ["fluxo"] });
  }

  const criar = useMutation({
    mutationFn: () => api.post("/api/categorias", { nome: novoNome.trim() }),
    onSuccess: () => {
      toast.success("Categoria criada");
      setNovoNome("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const salvar = useMutation({
    mutationFn: () =>
      api.patch(`/api/categorias/${editingId}`, { nome: editNome.trim() }),
    onSuccess: () => {
      toast.success("Categoria atualizada");
      setEditingId(null);
      setEditNome("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function excluir(c: Categoria) {
    const msg = c.ativo
      ? `Remover “${c.nome}”? Se estiver em uso, ela será apenas desativada.`
      : `Excluir definitivamente “${c.nome}”?`;
    if (!confirm(msg)) return;
    try {
      const res = await api.delete<{ softDeleted?: boolean }>(`/api/categorias/${c.id}`);
      toast.success(res.softDeleted ? "Categoria desativada (ainda em uso)" : "Categoria excluída");
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function reativar(c: Categoria) {
    try {
      await api.patch(`/api/categorias/${c.id}`, { ativo: true });
      toast.success("Categoria reativada");
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function startEdit(c: Categoria) {
    setEditingId(c.id);
    setEditNome(c.nome);
  }

  const rows = q.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--text)]/45 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg text-[var(--text)]">Gerenciar categorias</h3>
          <button
            type="button"
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!novoNome.trim()) return;
            criar.mutate();
          }}
        >
          <input
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="Nova categoria"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
          />
          <button
            type="submit"
            disabled={criar.isPending || !novoNome.trim()}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-[var(--on-accent)] disabled:opacity-50"
          >
            Adicionar
          </button>
        </form>

        {q.isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto space-y-1 text-sm">
            {rows.map((c) => (
              <li
                key={c.id}
                className={`flex items-center gap-2 border-b border-[var(--border)] py-2 ${
                  c.ativo ? "" : "opacity-60"
                }`}
              >
                {editingId === c.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!editNome.trim()) return;
                      salvar.mutate();
                    }}
                  >
                    <input
                      autoFocus
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
                      value={editNome}
                      onChange={(e) => setEditNome(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="text-xs text-[var(--accent)]"
                      disabled={salvar.isPending}
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      className="text-xs text-[var(--text-muted)]"
                      onClick={() => setEditingId(null)}
                    >
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 truncate">
                      {c.nome}
                      {!c.ativo && (
                        <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          inativa
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      title="Editar"
                      aria-label="Editar"
                      onClick={() => startEdit(c)}
                    >
                      <Pencil size={14} />
                    </button>
                    {!c.ativo ? (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-[var(--bg)] text-[var(--accent)]"
                        title="Reativar"
                        aria-label="Reativar"
                        onClick={() => reativar(c)}
                      >
                        <RotateCcw size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-[var(--bg)] text-[var(--red)]"
                        title="Excluir"
                        aria-label="Excluir"
                        onClick={() => excluir(c)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
            {rows.length === 0 && (
              <li className="py-4 text-center text-[var(--text-muted)]">Nenhuma categoria</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
