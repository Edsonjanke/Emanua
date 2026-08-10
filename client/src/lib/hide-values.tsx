import React, { createContext, useContext, useState } from "react";

const Ctx = createContext<{ hidden: boolean; toggle: () => void; format: (n: number) => string } | null>(
  null,
);

export function MoneyProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const format = (n: number) => {
    if (hidden) return "R$ ●●●";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };
  return (
    <Ctx.Provider value={{ hidden, toggle: () => setHidden((h) => !h), format }}>{children}</Ctx.Provider>
  );
}

export function useMoney() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMoney fora do provider");
  return v;
}

export function formatMoney(n: number, hidden = false) {
  if (hidden) return "R$ ●●●";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
