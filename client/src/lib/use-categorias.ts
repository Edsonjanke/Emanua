import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type Categoria = {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  createdAt?: string;
};

export function useCategorias(opts?: { todos?: boolean }) {
  const todos = !!opts?.todos;
  return useQuery({
    queryKey: ["categorias", todos ? "todos" : "ativos"],
    queryFn: () =>
      api.get<Categoria[]>(todos ? "/api/categorias?todos=1" : "/api/categorias"),
  });
}

/** Nomes ativos para `<select>`; inclui `current` se estiver ausente (ex.: categoria inativa). */
export function nomesCategorias(rows: Categoria[] | undefined, current?: string | null): string[] {
  const nomes = (rows ?? []).filter((c) => c.ativo).map((c) => c.nome);
  if (current && !nomes.includes(current)) nomes.push(current);
  return nomes;
}
