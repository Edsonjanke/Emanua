import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Helpers compartilhados (usados também pelo confirmar.tsx)           */
/* ------------------------------------------------------------------ */

let travas = 0;
let overflowAnterior = "";

/** Trava o scroll do body enquanto `ativo`. Conta empilhamentos. */
export function useTravaScrollBody(ativo: boolean): void {
  useEffect(() => {
    if (!ativo) return;
    if (travas === 0) {
      overflowAnterior = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    travas += 1;
    return () => {
      travas -= 1;
      if (travas === 0) document.body.style.overflow = overflowAnterior;
    };
  }, [ativo]);
}

const FOCAVEIS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Esc fecha, Tab fica preso no painel, foco inicial no painel e
 * devolução do foco ao elemento anterior quando fecha.
 */
export function useFocoModal(
  aberto: boolean,
  ref: RefObject<HTMLElement>,
  onClose: () => void,
): void {
  // onClose fica em ref para o efeito não re-rodar (e roubar o foco de um
  // input interno) quando o consumidor passa uma arrow function inline.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const painel = ref.current;
    painel?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const no = ref.current;
      if (!no) return;
      const itens = Array.from(no.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (itens.length === 0) {
        e.preventDefault();
        no.focus();
        return;
      }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || atual === no)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      anterior?.focus?.();
    };
  }, [aberto, ref]);
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

/**
 * Painel lateral direito no desktop, bottom-sheet no mobile.
 * Fecha no Esc e no clique do backdrop.
 */
export function Sheet({
  open,
  onClose,
  titulo,
  descricao,
  children,
  footer,
  largura = "28rem",
}: {
  open: boolean;
  onClose: () => void;
  titulo?: ReactNode;
  descricao?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  largura?: string;
}): JSX.Element | null {
  const painelRef = useRef<HTMLDivElement>(null);
  const tituloId = "sheet-titulo";
  const descId = "sheet-descricao";

  useTravaScrollBody(open);
  useFocoModal(open, painelRef, onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
      <div
        className="absolute inset-0 bg-[var(--text)]/30"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo ? tituloId : undefined}
        aria-describedby={descricao ? descId : undefined}
        tabIndex={-1}
        style={{ ["--sheet-w" as string]: largura }}
        className="relative flex max-h-[88vh] w-full flex-col rounded-t-2xl border border-[var(--border)] bg-[var(--bg-elevated)] outline-none sm:max-h-none sm:h-full sm:w-[var(--sheet-w)] sm:max-w-full sm:rounded-none sm:rounded-l-2xl sm:border-y-0 sm:border-r-0"
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            {titulo && (
              <h2 id={tituloId} className="text-lg font-medium text-[var(--text)]">
                {titulo}
              </h2>
            )}
            {descricao && (
              <p id={descId} className="mt-0.5 text-xs text-[var(--text-muted)]">
                {descricao}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-11 pointer-fine:size-8 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <div className="border-t border-[var(--border)] px-4 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Sheet;
