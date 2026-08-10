import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";
import { hojeBrasil } from "@/lib/date";

export default function ContasReceberTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["recebiveis"],
    queryFn: () => api.get<any[]>("/api/recebiveis"),
  });
  const [form, setForm] = useState({
    clienteNome: "",
    descricao: "",
    valor: "",
    dataVencimento: hojeBrasil(),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/recebiveis", {
        ...form,
        valor: Number(form.valor),
      }),
    onSuccess: () => {
      toast.success("Recebível criado");
      setForm({ clienteNome: "", descricao: "", valor: "", dataVencimento: hojeBrasil() });
      qc.invalidateQueries({ queryKey: ["recebiveis"] });
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
        <Field label="Cliente" value={form.clienteNome} onChange={(v) => setForm({ ...form, clienteNome: v })} required />
        <Field label="Descrição" value={form.descricao} onChange={(v) => setForm({ ...form, descricao: v })} />
        <Field label="Valor" type="number" value={form.valor} onChange={(v) => setForm({ ...form, valor: v })} required />
        <Field
          label="Vencimento"
          type="date"
          value={form.dataVencimento}
          onChange={(v) => setForm({ ...form, dataVencimento: v })}
          required
        />
        <button type="submit" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">
          Adicionar
        </button>
      </form>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[var(--text-muted)] text-left">
            <tr>
              <th className="p-3">Cliente</th>
              <th>Descrição</th>
              <th>Vencimento</th>
              <th>Valor</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="p-3">{r.clienteNome}</td>
                <td>{r.descricao}</td>
                <td>{formatDateBR(r.dataVencimento)}</td>
                <td className="text-[var(--green)]">{format(Number(r.valor))}</td>
                <td>{r.status}</td>
                <td className="p-3 space-x-2">
                  {r.status === "aberta" && (
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)]"
                      onClick={() =>
                        api
                          .patch(`/api/recebiveis/${r.id}`, { status: "paga", valorPago: r.valor })
                          .then(() => {
                            qc.invalidateQueries({ queryKey: ["recebiveis"] });
                            qc.invalidateQueries({ queryKey: ["fluxo"] });
                          })
                      }
                    >
                      Baixar
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs text-[var(--red)]"
                    onClick={() =>
                      api.delete(`/api/recebiveis/${r.id}`).then(() => {
                        qc.invalidateQueries({ queryKey: ["recebiveis"] });
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

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <input
        type={type}
        required={required}
        className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
