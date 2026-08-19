/**
 * Campo de número escrito em português — o campo de DINHEIRO do app.
 *
 * Antes era `<input type="number">` em todo lugar que pedia um valor. Num
 * teclado brasileiro, digitar "99,90" — como está no boleto, na nota e no
 * extrato — dava uma conta de R$ 9.990,00 ou um campo vazio, dependendo do
 * navegador. O app lia "1.234,56" do arquivo do banco sem hesitar e se recusava
 * a ler do próprio teclado.
 *
 * Aqui o campo é texto (`inputMode="decimal"` mantém o teclado numérico no
 * celular) e quem entende o que foi escrito é `parseBrNumber` — o MESMO parser
 * do CSV e do OFX. Ao sair do campo, o que ficou legível é reescrito formatado,
 * para a usuária ver o que o sistema entendeu antes de salvar.
 */

import type { InputHTMLAttributes } from "react";
import { parseBrNumber } from "@shared/parse-br";

/** 1234.56 → "1.234,56". `casas: null` deixa livre (útil para %: 58,5). */
export function textoDecimalBr(n: number, casas: number | null = 2): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas ?? 0,
    maximumFractionDigits: casas ?? 2,
  });
}

/**
 * O que veio do servidor (99.9, "99.90", null) vira o texto do campo ("99,90").
 * Sem isto, abrir uma conta para editar mostrava "99.9" — o formato de máquina
 * dentro de um campo que agora fala português.
 */
export function paraCampoDecimalBr(v: unknown, casas: number | null = 2): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : parseBrNumber(String(v));
  return n === null ? String(v) : textoDecimalBr(n, casas);
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (texto: string) => void;
  /** Casas decimais ao reformatar no blur. `null` = livres (0 a 2). */
  casas?: number | null;
};

export function InputDecimalBr({ value, onChange, casas = 2, onBlur, ...rest }: Props) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        // Só reescreve o que deu para ler. Texto ilegível fica como está, para
        // a usuária ver o que digitou junto da mensagem de erro — apagar o que
        // ela escreveu seria esconder o problema.
        const n = parseBrNumber(e.target.value);
        if (n !== null) {
          const formatado = textoDecimalBr(n, casas);
          if (formatado !== value) onChange(formatado);
        }
        onBlur?.(e);
      }}
    />
  );
}
