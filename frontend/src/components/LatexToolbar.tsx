"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * LaTeX 도구 모음 — 자주 쓰는 구조(첨자·분수·합·적분·수식·그림·표)와
 * 그리스 문자·수학 기호 팔레트. 선택 영역이 있으면 감싸고, 없으면 커서를
 * 입력 위치로 보낸다.
 */

export type InsertFn = (before: string, after?: string, placeholder?: string) => void;

const STRUCTURES: { label: string; title: string; before: string; after?: string; placeholder?: string }[] = [
  { label: "x₂", title: "아래첨자", before: "_{", after: "}" },
  { label: "x²", title: "위첨자", before: "^{", after: "}" },
  { label: "a/b", title: "분수", before: "\\frac{", after: "}{}" },
  { label: "√", title: "제곱근", before: "\\sqrt{", after: "}" },
  { label: "Σ", title: "합(시그마)", before: "\\sum_{i=1}^{n} " },
  { label: "∫", title: "적분", before: "\\int_{0}^{t} " },
  { label: "$x$", title: "인라인 수식", before: "$", after: "$" },
  { label: "[≡]", title: "수식 블록 (equation)", before: "\\begin{equation}\n  ", after: "\n\\end{equation}" },
  { label: "🖼", title: "그림 삽입 골격", before: "\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=\\linewidth]{", after: "}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}", placeholder: "figures/" },
  { label: "⊞", title: "표 골격", before: "\\begin{table}[ht]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{lcc}\n    \\hline\n    ", after: " &  &  \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}" },
  { label: "[1]", title: "인용", before: "\\cite{", after: "}" },
  { label: "§→", title: "상호참조", before: "\\ref{", after: "}" },
];

const GREEK: [string, string][] = [
  ["α", "\\alpha"], ["β", "\\beta"], ["γ", "\\gamma"], ["δ", "\\delta"], ["ε", "\\epsilon"],
  ["ζ", "\\zeta"], ["η", "\\eta"], ["θ", "\\theta"], ["κ", "\\kappa"], ["λ", "\\lambda"],
  ["μ", "\\mu"], ["ν", "\\nu"], ["ξ", "\\xi"], ["π", "\\pi"], ["ρ", "\\rho"],
  ["σ", "\\sigma"], ["τ", "\\tau"], ["φ", "\\phi"], ["χ", "\\chi"], ["ψ", "\\psi"],
  ["ω", "\\omega"], ["Γ", "\\Gamma"], ["Δ", "\\Delta"], ["Θ", "\\Theta"], ["Λ", "\\Lambda"],
  ["Ξ", "\\Xi"], ["Π", "\\Pi"], ["Σ", "\\Sigma"], ["Φ", "\\Phi"], ["Ψ", "\\Psi"], ["Ω", "\\Omega"],
];

const SYMBOLS: [string, string][] = [
  ["≤", "\\leq"], ["≥", "\\geq"], ["≠", "\\neq"], ["≈", "\\approx"], ["≡", "\\equiv"],
  ["±", "\\pm"], ["∓", "\\mp"], ["×", "\\times"], ["·", "\\cdot"], ["÷", "\\div"],
  ["∞", "\\infty"], ["∂", "\\partial"], ["∇", "\\nabla"], ["∝", "\\propto"], ["°", "^{\\circ}"],
  ["∈", "\\in"], ["∉", "\\notin"], ["⊂", "\\subset"], ["∪", "\\cup"], ["∩", "\\cap"],
  ["→", "\\rightarrow"], ["⇒", "\\Rightarrow"], ["↔", "\\leftrightarrow"], ["∴", "\\therefore"], ["…", "\\dots"],
  ["ℓ", "\\ell"], ["ħ", "\\hbar"], ["∠", "\\angle"], ["⊥", "\\perp"], ["∥", "\\parallel"],
];

function Palette({
  title,
  ariaLabel,
  items,
  onPick,
}: {
  title: string;
  ariaLabel: string;
  items: [string, string][];
  onPick: (cmd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-mono text-[13px] transition ${
          open ? "bg-accent/10 text-accent" : "text-ink/55 hover:bg-ink/5 hover:text-ink"
        }`}
      >
        {title} <ChevronDown size={11} />
      </button>
      {open && (
        <div
          data-testid="palette"
          className="absolute left-0 top-full z-30 mt-1.5 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-black/5 bg-white p-2 shadow-card-hover"
        >
          {items.map(([glyph, cmd]) => (
            <button
              key={cmd}
              type="button"
              title={cmd}
              onClick={() => {
                onPick(cmd);
                setOpen(false);
              }}
              className="grid h-7 w-7 place-items-center rounded-md font-mono text-sm text-ink/70 transition hover:bg-accent/10 hover:text-accent"
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LatexToolbar({ onInsert }: { onInsert: InsertFn }) {
  return (
    <div
      data-testid="latex-toolbar"
      className="flex flex-wrap items-center gap-0.5 border-b border-black/5 bg-gray-50/70 px-3 py-1.5"
    >
      {STRUCTURES.map((s) => (
        <button
          key={s.title}
          type="button"
          aria-label={s.title}
          title={s.title}
          onClick={() => onInsert(s.before, s.after ?? "", s.placeholder ?? "")}
          className="grid h-7 min-w-7 place-items-center rounded-lg px-1.5 font-mono text-[13px] text-ink/55 transition hover:bg-ink/5 hover:text-ink"
        >
          {s.label}
        </button>
      ))}
      <span className="mx-1.5 h-4 w-px bg-black/10" />
      <Palette title="αβ" ariaLabel="그리스 문자" items={GREEK} onPick={(cmd) => onInsert(`${cmd} `)} />
      <Palette title="≤±" ariaLabel="수학 기호" items={SYMBOLS} onPick={(cmd) => onInsert(`${cmd} `)} />
    </div>
  );
}
