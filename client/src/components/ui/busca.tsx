import { useId } from "react";
import { Search, X } from "lucide-react";

/** Campo de busca com lupa e botão de limpar quando há texto. */
export function Busca({
  valor,
  onChange,
  placeholder = "Buscar…",
  className = "",
  ariaLabel,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  const id = useId();
  return (
    <div className={`relative ${className}`}>
      <Search
        size={15}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
      />
      <input
        id={id}
        type="search"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        // 44px de alvo. Só encolhe onde há ponteiro fino E largura de desktop —
        // girar o celular atravessa o `sm:` mas continua sendo dedo.
        className="w-full min-h-11 sm:pointer-fine:min-h-0 rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-strong)] [&::-webkit-search-cancel-button]:appearance-none"
      />
      {valor !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 grid size-9 pointer-fine:size-6 -translate-y-1/2 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text)]"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

export default Busca;
