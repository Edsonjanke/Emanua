export class ApiError extends Error {
  status: number;
  /**
   * Corpo da resposta, inteiro. Existe porque nem toda recusa é um erro: o
   * import devolve 409 com uma PERGUNTA ("este arquivo é de outra conta — o que
   * você quer fazer?") e nada foi gravado. Sem o corpo, a tela só teria a frase
   * solta e mostraria uma pergunta como se fosse falha.
   */
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data ?? null;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 401 && !url.includes("/auth/")) {
    window.location.href = "/login";
    throw new ApiError(401, "Não autenticado");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.message || res.statusText, data);
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>(url),
  post: <T,>(url: string, body: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T,>(url: string, body: unknown) =>
    request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T,>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T,>(url: string) => request<T>(url, { method: "DELETE" }),
  upload: async <T,>(url: string, file: File, field = "file") => {
    const fd = new FormData();
    fd.append(field, file);
    const res = await fetch(url, { method: "POST", body: fd, credentials: "include" });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data?.message || res.statusText, data);
    return data as T;
  },
};
