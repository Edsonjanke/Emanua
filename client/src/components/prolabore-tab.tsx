import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";

export default function ProLaboreTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["pro-labore"],
    queryFn: () => api.get<any>("/api/pro-labore"),
  });
  const [regra, setRegra] = useState({ socio: "", padrao: "", ordem: "0" });

  const addRegra = useMutation({
    mutationFn: () =>
      api.post("/api/pro-labore/regras", {
        socio: regra.socio,
        padrao: regra.padrao,
        ordem: Number(regra.ordem) || 0,
      }),
    onSuccess: () => {
      toast.success("Regra criada");
      setRegra({ socio: "", padrao: "", ordem: "0" });
      qc.invalidateQueries({ queryKey: ["pro-labore"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (q.isLoading) return <p className="text-[var(--text-muted)]">Carregando…</p>;
  const data = q.data!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {Object.entries(data.porSocio as Record<string, number>).map(([socio, total]) => (
          <div key={socio} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <p className="text-xs uppercase text-[var(--text-muted)]">{socio}</p>
            <p className="text-xl text-[var(--text)]">{format(total)}</p>
          </div>
        ))}
        {Object.keys(data.porSocio).length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">
            Nenhum pró-labore classificado neste período. Use as regras abaixo ou marque linhas na
            tabela.
          </p>
        )}
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm font-medium text-[var(--text)] mb-3">Regras de classificação</h2>
        <ul className="text-sm space-y-1 mb-4">
          {(data.regras ?? []).map((r: any) => (
            <li key={r.id} className="flex justify-between gap-2 border-b border-[var(--border)] py-1">
              <span>
                <strong>{r.socio}</strong> ← “{r.padrao}” (ordem {r.ordem})
              </span>
              <button
                type="button"
                className="text-[var(--red-text)] text-xs"
                onClick={() =>
                  api.delete(`/api/pro-labore/regras/${r.id}`).then(() =>
                    qc.invalidateQueries({ queryKey: ["pro-labore"] }),
                  )
                }
              >
                Excluir
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 items-end">
          <input
            placeholder="Sócio (ex.: ataize)"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={regra.socio}
            onChange={(e) => setRegra({ ...regra, socio: e.target.value })}
          />
          <input
            placeholder="Padrão no histórico"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={regra.padrao}
            onChange={(e) => setRegra({ ...regra, padrao: e.target.value })}
          />
          <input
            type="number"
            placeholder="Ordem"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-20"
            value={regra.ordem}
            onChange={(e) => setRegra({ ...regra, ordem: e.target.value })}
          />
          <button
            type="button"
            onClick={() => addRegra.mutate()}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-[var(--on-accent)]"
          >
            Adicionar regra
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[var(--text-muted)] text-left">
            <tr>
              <th className="p-3">Data</th>
              <th>Histórico</th>
              <th>Valor</th>
              <th>Natureza</th>
              <th>Sócio</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data.itens ?? []).map((i: any) => (
              <tr key={i.id} className="border-t border-[var(--border)]">
                <td className="p-3">{formatDateBR(i.data)}</td>
                <td className="max-w-xs truncate">{i.historico}</td>
                <td>{format(i.valor)}</td>
                <td>
                  {i.natureza === "pro_labore"
                    ? "Pró-labore"
                    : i.natureza === "empresa"
                      ? "Empresa"
                      : i.natureza === "pendente"
                        ? "Sem classificar"
                        : i.natureza}
                </td>
                <td>{i.socio ?? "—"}</td>
                <td className="p-3 space-x-1">
                  <button
                    type="button"
                    className="text-xs text-[var(--accent-text)]"
                    onClick={() => {
                      const socio = prompt("Pró-labore de qual sócio?", i.socio || "ataize");
                      if (!socio) return;
                      api.patch(`/api/extrato/${i.id}/prolabore`, { override: socio }).then(() => {
                        toast.success(`Classificado como pró-labore de ${socio}`);
                        qc.invalidateQueries({ queryKey: ["pro-labore"] });
                        qc.invalidateQueries({ queryKey: ["fluxo"] });
                      });
                    }}
                  >
                    É pró-labore
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--text-muted)]"
                    onClick={() =>
                      api.patch(`/api/extrato/${i.id}/prolabore`, { override: "excluir" }).then(() => {
                        toast.success("Marcado como despesa da empresa");
                        qc.invalidateQueries({ queryKey: ["pro-labore"] });
                        qc.invalidateQueries({ queryKey: ["fluxo"] });
                      })
                    }
                  >
                    É da empresa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
