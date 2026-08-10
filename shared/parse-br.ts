/** Parse helpers BR (número e data). */

export function parseBrNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const limpo = s.trim().replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

/** "17/04/2026" (ou ISO) → "2026-04-17". Inválido → null. */
export function parseBrDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const br = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}
