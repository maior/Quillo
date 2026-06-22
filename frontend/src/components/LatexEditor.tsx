"use client";

import { RefObject, useMemo, useRef, useState } from "react";

/**
 * LaTeX syntax-highlighting editor — overlay approach.
 *
 * The actual input is still handled by the original textarea (autosave, snippet insertion,
 * and tests all remain intact). Only the text color is made transparent, and a layer with the
 * same typography is placed behind it: the textarea owns the cursor and selection, while the
 * layer owns the colors (syntax) and highlights (commented ranges). No dependencies.
 *
 * Extra features:
 * - marks: highlights commented ranges
 * - backslash (\) autocomplete: typing \ shows command candidates, select with ↑↓ + Enter
 */

type Token = { text: string; kind: TokenKind };
type TokenKind = "command" | "comment" | "math" | "brace" | "special" | "env" | "plain";

// colors target the light theme — 5 families clearly distinct from the body text (ink)
const TOKEN_CLS: Record<TokenKind, string> = {
  command: "text-blue-600",
  comment: "italic text-slate-400",
  math: "text-purple-600",
  brace: "text-amber-600",
  special: "text-rose-600",
  env: "font-semibold text-emerald-600",
  plain: "",
};

// a single sequential scan — match commands first so \% is not mistaken for a comment
const TOKEN_RE =
  /(\\(?:[a-zA-Z@]+\*?|.))|(%[^\n]*)|(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)|([{}[\]])|([&^_~])/g;

export function tokenizeLatex(src: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let pendingEnv = false; // previous token was \begin/\end — treat the next {name} as env
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(src); m; m = TOKEN_RE.exec(src)) {
    if (m.index > last) {
      tokens.push({ text: src.slice(last, m.index), kind: "plain" });
      if (!/^\s*$/.test(src.slice(last, m.index))) pendingEnv = false;
    }
    const [text] = m;
    let kind: TokenKind;
    if (m[1]) kind = "command";
    else if (m[2]) kind = "comment";
    else if (m[3]) kind = "math";
    else if (m[4]) kind = "brace";
    else kind = "special";

    if (kind === "command") {
      pendingEnv = text === "\\begin" || text === "\\end";
      tokens.push({ text, kind });
    } else if (pendingEnv && text === "{") {
      // highlight the environment name in \begin{figure}
      const rest = src.slice(m.index + 1);
      const env = /^[a-zA-Z*]+(?=\})/.exec(rest);
      tokens.push({ text, kind: "brace" });
      if (env) {
        tokens.push({ text: env[0], kind: "env" });
        TOKEN_RE.lastIndex = m.index + 1 + env[0].length;
      }
      pendingEnv = false;
    } else {
      if (kind !== "brace") pendingEnv = false;
      tokens.push({ text, kind });
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < src.length) tokens.push({ text: src.slice(last), kind: "plain" });
  return tokens;
}

// define typography in one place so the textarea and layer overlap pixel-for-pixel
const TYPO = "p-5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words";

export function LatexHighlight({ value, className = "" }: { value: string; className?: string }) {
  const tokens = useMemo(() => tokenizeLatex(value), [value]);
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "plain" ? (
          t.text
        ) : (
          <span key={i} className={TOKEN_CLS[t.kind] + className}>
            {t.text}
          </span>
        ),
      )}
      {"\n" /* keep the height of the last line */}
    </>
  );
}

// ── comment mark layer — text is transparent, only the range background is highlighted ──
export type Mark = { start: number; end: number };

function MarkLayer({ value, marks }: { value: string; marks: Mark[] }) {
  const sorted = [...marks]
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((m, i) => {
    const s = Math.max(pos, Math.min(m.start, value.length));
    const e = Math.max(s, Math.min(m.end, value.length));
    if (s > pos) out.push(value.slice(pos, s));
    out.push(
      <span key={i} data-testid="comment-mark" className="rounded-[3px] bg-amber-300/40 box-decoration-clone">
        {value.slice(s, e)}
      </span>,
    );
    pos = e;
  });
  out.push(value.slice(pos));
  return (
    <>
      {out}
      {"\n"}
    </>
  );
}

// ── backslash autocomplete command dictionary ──
type Command = { insert: string; label: string };
const C = (insert: string, label: string): Command => ({ insert, label });
const COMMANDS: Command[] = [
  C("\\section{}", "Section heading"),
  C("\\subsection{}", "Subsection heading"),
  C("\\subsubsection{}", "Subsubsection heading"),
  C("\\textbf{}", "Bold"),
  C("\\textit{}", "Italic"),
  C("\\emph{}", "Emphasis"),
  C("\\underline{}", "Underline"),
  C("\\texttt{}", "Monospace"),
  C("\\cite{}", "Citation"),
  C("\\ref{}", "Cross-reference"),
  C("\\label{}", "Label"),
  C("\\caption{}", "Caption"),
  C("\\footnote{}", "Footnote"),
  C("\\frac{}{}", "Fraction"),
  C("\\sqrt{}", "Square root"),
  C("\\sum_{}^{}", "Sum Σ"),
  C("\\int_{}^{}", "Integral ∫"),
  C("\\includegraphics[width=\\linewidth]{}", "Insert image"),
  C(
    "\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}",
    "Figure environment",
  ),
  C(
    "\\begin{table}[ht]\n  \\caption{}\n  \\centering\n  \\begin{tabular}{lcc}\n    \\hline\n     &  &  \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}",
    "Table environment",
  ),
  C("\\begin{equation}\n  \n\\end{equation}", "Equation environment"),
  C("\\begin{itemize}\n  \\item \n\\end{itemize}", "Bulleted list"),
  C("\\begin{enumerate}\n  \\item \n\\end{enumerate}", "Numbered list"),
  C("\\begin{abstract}\n\n\\end{abstract}", "Abstract"),
  C("\\item ", "List item"),
  C("\\maketitle", "Make title"),
  C("\\tableofcontents", "Table of contents"),
  C("\\usepackage{}", "Load package"),
  C("\\input{}", "Include file"),
  C("\\centering", "Center"),
  C("\\textsuperscript{}", "Superscript"),
  C("\\textsubscript{}", "Subscript"),
  C("\\textcolor{}{}", "Text color"),
  C("\\alpha", "α"),
  C("\\beta", "β"),
  C("\\gamma", "γ"),
  C("\\delta", "δ"),
  C("\\sigma", "σ"),
  C("\\mu", "µ"),
  C("\\circ", "° (degree symbol)"),
  C("\\times", "×"),
  C("\\pm", "±"),
  C("\\leq", "≤"),
  C("\\geq", "≥"),
  C("\\hline", "Table rule"),
  C("\\newpage", "Page break"),
  C("\\noindent", "No indent"),
  C("\\vspace{}", "Vertical space"),
  C("\\hspace{}", "Horizontal space"),
];

function caretInInsert(insert: string): number {
  const brace = insert.indexOf("{}");
  if (brace >= 0) return brace + 1;
  const blank = insert.indexOf("\n  \n");
  if (blank >= 0) return blank + 3;
  return insert.length;
}

/** pixel coordinates of the textarea caret — measured with an identical-typography mirror */
function caretCoords(ta: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const div = document.createElement("div");
  const cs = getComputedStyle(ta);
  for (const prop of [
    "fontFamily",
    "fontSize",
    "lineHeight",
    "letterSpacing",
    "padding",
    "borderWidth",
    "boxSizing",
  ] as const) {
    div.style[prop] = cs[prop];
  }
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordBreak = "break-word";
  div.style.width = `${ta.clientWidth}px`;
  div.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  div.appendChild(marker);
  (ta.parentElement ?? document.body).appendChild(div);
  const lineH = parseFloat(cs.lineHeight) || 21;
  const coords = {
    top: marker.offsetTop - ta.scrollTop + lineH + 4,
    left: Math.min(marker.offsetLeft - ta.scrollLeft, ta.clientWidth - 280),
  };
  div.remove();
  return coords;
}

type Menu = {
  open: boolean;
  items: Command[];
  sel: number;
  start: number; // index of the '\'
  top: number;
  left: number;
};

const MENU_CLOSED: Menu = { open: false, items: [], sel: 0, start: 0, top: 0, left: 0 };

export default function LatexEditor({
  value,
  onChange,
  textareaRef,
  marks = [],
  onSelectionChange,
}: {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  marks?: Mark[];
  onSelectionChange?: (start: number, end: number) => void;
}) {
  const backRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu>(MENU_CLOSED);

  const syncScroll = () => {
    const ta = textareaRef.current;
    for (const layer of [backRef.current, markRef.current]) {
      if (ta && layer) {
        layer.scrollTop = ta.scrollTop;
        layer.scrollLeft = ta.scrollLeft;
      }
    }
  };

  // find the "\prefix" right before the caret — do not open after "\\" (the line-break command)
  const detectMenu = (val: string, caret: number) => {
    const upto = val.slice(Math.max(0, caret - 30), caret);
    const m = /\\([a-zA-Z]*)$/.exec(upto);
    if (!m) return null;
    const start = caret - m[1].length - 1;
    if (start > 0 && val[start - 1] === "\\") return null;
    return { prefix: m[1], start };
  };

  const refreshMenu = (val: string, caret: number) => {
    const hit = detectMenu(val, caret);
    if (!hit) {
      if (menu.open) setMenu(MENU_CLOSED);
      return;
    }
    const q = hit.prefix.toLowerCase();
    const starts = COMMANDS.filter((c) => c.insert.slice(1).toLowerCase().startsWith(q));
    const contains = COMMANDS.filter(
      (c) => !starts.includes(c) && c.insert.slice(1).toLowerCase().includes(q),
    );
    const items = [...starts, ...contains].slice(0, 9);
    if (items.length === 0) {
      if (menu.open) setMenu(MENU_CLOSED);
      return;
    }
    const ta = textareaRef.current;
    const pos = ta ? caretCoords(ta, hit.start) : { top: 0, left: 0 };
    setMenu({ open: true, items, sel: 0, start: hit.start, ...pos });
  };

  const applyCommand = (cmd: Command) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? value.length;
    const next = value.slice(0, menu.start) + cmd.insert + value.slice(caret);
    onChange(next);
    setMenu(MENU_CLOSED);
    const pos = menu.start + caretInInsert(cmd.insert);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu.open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setMenu((m) => ({ ...m, sel: (m.sel + d + m.items.length) % m.items.length }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyCommand(menu.items[menu.sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMenu(MENU_CLOSED);
    }
  };

  const handleSelect = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    onSelectionChange?.(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
    // close the menu when the caret moves away from the trigger position
    if (menu.open) {
      const hit = detectMenu(ta.value, ta.selectionStart ?? 0);
      if (!hit || hit.start !== menu.start) setMenu(MENU_CLOSED);
    }
  };

  return (
    <div className="relative min-h-0 flex-1 bg-white">
      {marks.length > 0 && (
        <div
          ref={markRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 overflow-hidden text-transparent ${TYPO}`}
        >
          <MarkLayer value={value} marks={marks} />
        </div>
      )}
      <div
        ref={backRef}
        aria-hidden
        data-testid="latex-highlight"
        className={`pointer-events-none absolute inset-0 overflow-hidden text-ink ${TYPO}`}
      >
        <LatexHighlight value={value} />
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          refreshMenu(e.target.value, e.target.selectionStart ?? 0);
        }}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onBlur={() => setTimeout(() => setMenu(MENU_CLOSED), 150)}
        spellCheck={false}
        style={{ WebkitTextFillColor: "transparent", color: "transparent", caretColor: "#10131a" }}
        className={`absolute inset-0 block h-full w-full resize-none bg-transparent outline-none selection:bg-accent/20 ${TYPO}`}
      />
      {/* command autocomplete menu */}
      {menu.open && (
        <div
          data-testid="cmd-menu"
          style={{ top: menu.top, left: Math.max(8, menu.left) }}
          className="absolute z-30 w-72 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10"
        >
          {menu.items.map((c, i) => (
            <button
              key={c.insert}
              data-testid="cmd-item"
              onMouseDown={(e) => {
                e.preventDefault(); // apply before blur closes the menu
                applyCommand(c);
              }}
              onMouseEnter={() => setMenu((m) => ({ ...m, sel: i }))}
              className={`flex w-full items-baseline gap-2.5 px-3.5 py-2 text-left transition ${
                i === menu.sel ? "bg-accent/10" : ""
              }`}
            >
              <span className="font-mono text-xs text-blue-600">
                {c.insert.split("\n")[0]}
                {c.insert.includes("\n") ? " …" : ""}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-ink/45">{c.label}</span>
            </button>
          ))}
          <p className="border-t border-black/5 px-3.5 py-1.5 text-[10px] text-ink/35">
            ↑↓ Navigate · Enter Select · Esc Close
          </p>
        </div>
      )}
    </div>
  );
}
