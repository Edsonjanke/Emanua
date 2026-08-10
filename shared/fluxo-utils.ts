/** Helpers de data/saldo do fluxo (puros, testáveis). */

export function hojeBrasil(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DiaReal {
  entradas: number;
  saidas: number;
  saidasEmpresa: number;
  saidasProLabore: number;
}

export function emptyDiaReal(): DiaReal {
  return { entradas: 0, saidas: 0, saidasEmpresa: 0, saidasProLabore: 0 };
}
