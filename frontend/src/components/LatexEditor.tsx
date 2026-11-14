"use client";

import { RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

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
 * - \cite{ · \ref{ autocomplete: the manuscript's citation keys (.bib) and labels (\label)
 * - auto-pairing brackets ({} [] () $$), Tab indentation, Ctrl+/ comment toggle
 * - find & replace (Ctrl+F · Ctrl+H)
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
// for the dark editing theme — the same 5 families in lighter tones
const TOKEN_CLS_DARK: Record<TokenKind, string> = {
  command: "text-sky-300",
  comment: "italic text-slate-500",
  math: "text-fuchsia-300",
  brace: "text-amber-300",
  special: "text-rose-300",
  env: "font-semibold text-emerald-300",
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

export function LatexHighlight({ value, className = "", dark = false }: { value: string; className?: string; dark?: boolean }) {
  const cls = dark ? TOKEN_CLS_DARK : TOKEN_CLS;
  const tokens = useMemo(() => tokenizeLatex(value), [value]);
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "plain" ? (
          t.text
        ) : (
          <span key={i} className={cls[t.kind] + className}>
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

function MarkLayer({ value, marks, cls = "bg-amber-300/40", testid = "comment-mark" }: { value: string; marks: Mark[]; cls?: string; testid?: string }) {
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
      <span key={i} data-testid={testid} className={`rounded-[3px] ${cls} box-decoration-clone`}>
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

/** Scroll so pos is visible and select [start,end) — used to jump to an error line or a find result. */
export function revealInTextarea(ta: HTMLTextAreaElement, start: number, end = start, focus = true) {
  const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 21;
  const abs = caretCoords(ta, start).top + ta.scrollTop - lineH - 4; // y relative to the top of the text
  if (abs < ta.scrollTop + lineH || abs > ta.scrollTop + ta.clientHeight - lineH * 2) {
    ta.scrollTop = Math.max(0, abs - ta.clientHeight / 3);
  }
  if (focus) ta.focus();
  ta.setSelectionRange(start, end);
}

/** [start, end) offsets of the n-th line (1-based) */
export function lineRange(text: string, line: number): [number, number] {
  let start = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf("\n", start);
    if (nl < 0) break;
    start = nl + 1;
  }
  const nl = text.indexOf("\n", start);
  return [start, nl < 0 ? text.length : nl];
}

export type Suggest = { key: string; hint?: string };
const PAIRS: Record<string, string> = { "{": "}", "[": "]", "(": ")", $: "$" };
const CLOSERS = new Set(Object.values(PAIRS));

type Menu = {
  open: boolean;
  items: Command[];
  sel: number;
  start: number; // start of the range to replace (index of the '\' or of the key prefix)
  mode?: "cmd" | "key"; // key = a key inside \cite·\ref — inserted as is, caret moves past the brace
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
  cites = [],
  labels = [],
  dark = false,
}: {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  marks?: Mark[];
  onSelectionChange?: (start: number, end: number) => void;
  /** citation keys (.bib) suggested inside \cite{ */
  cites?: Suggest[];
  /** labels (\label) suggested inside \ref{ */
  labels?: Suggest[];
  /** dark editing theme */
  dark?: boolean;
}) {
  const backRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Menu>(MENU_CLOSED);
  const [find, setFind] = useState<{ open: boolean; replace: boolean; q: string; r: string; idx: number }>({ open: false, replace: false, q: "", r: "", idx: 0 });

  // selection to restore after a value change — applied right before the next paint (so the caret never jumps to the end while typing fast).
  const pendingSel = useRef<[number, number] | null>(null);
  const refreshRef = useRef<(val: string, caret: number) => void>(() => {});
  const skipRefresh = useRef(false); // do not reopen the menu right after a candidate was picked
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta && pendingSel.current) {
      const [a, b] = pendingSel.current;
      pendingSel.current = null;
      ta.setSelectionRange(a, b);
      if (a === b && !skipRefresh.current) refreshRef.current(ta.value, a); // show candidates right after a pair is created too
      skipRefresh.current = false;
    }
  }, [value, textareaRef]);
  const edit = (next: string, selStart: number, selEnd = selStart) => {
    if (next === value) {
      // same value, only the caret moves (skipping a closing bracket) — no re-render happens, so set it directly
      textareaRef.current?.setSelectionRange(selStart, selEnd);
      refreshRef.current(value, selStart);
      return;
    }
    pendingSel.current = [selStart, selEnd];
    onChange(next);
  };

  // find results (case-insensitive)
  const hits = useMemo(() => {
    const q = find.q.toLowerCase();
    if (!find.open || !q) return [] as Mark[];
    const hay = value.toLowerCase();
    const out: Mark[] = [];
    for (let i = hay.indexOf(q); i >= 0 && out.length < 2000; i = hay.indexOf(q, i + q.length)) out.push({ start: i, end: i + q.length });
    return out;
  }, [find.open, find.q, value]);
  const cur = hits.length ? ((find.idx % hits.length) + hits.length) % hits.length : -1;
  const gotoHit = (i: number) => {
    if (!hits.length) return;
    const n = ((i % hits.length) + hits.length) % hits.length;
    setFind((f) => ({ ...f, idx: n }));
    const ta = textareaRef.current;
    if (ta) revealInTextarea(ta, hits[n].start, hits[n].end, false);
  };
  const openFind = (replace: boolean) => {
    const ta = textareaRef.current;
    const sel = ta && ta.selectionEnd > ta.selectionStart ? value.slice(ta.selectionStart, ta.selectionEnd) : "";
    setFind((f) => ({ ...f, open: true, replace: replace || f.replace, q: sel && !sel.includes("\n") ? sel : f.q, idx: 0 }));
    requestAnimationFrame(() => findInput.current?.select());
  };
  const closeFind = () => {
    setFind((f) => ({ ...f, open: false }));
    textareaRef.current?.focus();
  };
  const replaceOne = () => {
    if (cur < 0) return;
    const h = hits[cur];
    edit(value.slice(0, h.start) + find.r + value.slice(h.end), h.start + find.r.length);
  };
  const replaceAll = () => {
    if (!hits.length) return;
    let out = "";
    let pos = 0;
    for (const h of hits) {
      out += value.slice(pos, h.start) + find.r;
      pos = h.end;
    }
    skipRefresh.current = true;
    edit(out + value.slice(pos), 0);
  };

  const syncScroll = () => {
    const ta = textareaRef.current;
    for (const layer of [backRef.current, markRef.current]) {
      if (ta && layer) {
        layer.scrollTop = ta.scrollTop;
        layer.scrollLeft = ta.scrollLeft;
      }
    }
    if (ta && findRef.current) {
      findRef.current.scrollTop = ta.scrollTop;
      findRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  // find the "\prefix" right before the caret — do not open after "\\" (the line-break command)
  const detectMenu = (val: string, caret: number): { prefix: string; start: number; keys?: Suggest[] } | null => {
    const upto = val.slice(Math.max(0, caret - 160), caret);
    // \cite{a,b|  ·  \ref{fig:|  — inside the braces, the prefix is what follows the last comma
    const k = /\\(cite[a-zA-Z]*|[a-zA-Z]*ref)\*?(?:\[[^\]]*\])*\{([^{}]*)$/.exec(upto);
    if (k) {
      const prefix = k[2].slice(k[2].lastIndexOf(",") + 1).replace(/^\s+/, "");
      return { prefix, start: caret - prefix.length, keys: k[1].startsWith("cite") ? cites : labels };
    }
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
    if (hit.keys) {
      const pool = hit.keys.filter((x) => x.key.toLowerCase().includes(q) || (x.hint ?? "").toLowerCase().includes(q));
      pool.sort((a, b) => Number(b.key.toLowerCase().startsWith(q)) - Number(a.key.toLowerCase().startsWith(q)));
      const keyItems = pool.slice(0, 9).map((x) => ({ insert: x.key, label: x.hint ?? "" }));
      if (keyItems.length === 0) {
        if (menu.open) setMenu(MENU_CLOSED);
        return;
      }
      const el = textareaRef.current;
      const at = el ? caretCoords(el, hit.start) : { top: 0, left: 0 };
      setMenu({ open: true, items: keyItems, sel: 0, start: hit.start, mode: "key", ...at });
      return;
    }
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

  refreshRef.current = refreshMenu;

  const applyCommand = (cmd: Command) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? value.length;
    const isKey = menu.mode === "key";
    // when inserting a key, add the closing brace if missing and move the caret past it
    const hasClose = value[caret] === "}";
    const close = isKey && !hasClose && value[caret] !== "," ? "}" : "";
    const next = value.slice(0, menu.start) + cmd.insert + close + value.slice(caret);
    const pos = menu.start + (isKey ? cmd.insert.length + (close || hasClose ? 1 : 0) : caretInInsert(cmd.insert));
    setMenu(MENU_CLOSED);
    ta.focus();
    pendingSel.current = [pos, pos];
    skipRefresh.current = true;
    onChange(next);
  };

  // [start, end) of the selected lines — used for indentation and comment toggling
  const lineBlock = (s: number, e: number): [number, number] => {
    const a = value.lastIndexOf("\n", s - 1) + 1;
    const nl = value.indexOf("\n", e > s && value[e - 1] === "\n" ? e - 1 : e);
    return [a, nl < 0 ? value.length : nl];
  };

  /** Editing shortcuts. Returns true when handled. */
  const editKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const ta = e.currentTarget;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === "f" || e.key === "h")) {
      openFind(e.key === "h");
      return true;
    }
    if (mod && e.key === "/") {
      const [a, b] = lineBlock(s, en);
      const lines = value.slice(a, b).split("\n");
      const all = lines.every((l) => /^\s*%/.test(l) || l.trim() === "");
      const out = lines.map((l) => (all ? l.replace(/^(\s*)% ?/, "$1") : l.trim() === "" ? l : l.replace(/^(\s*)/, "$1% "))).join("\n");
      edit(value.slice(0, a) + out + value.slice(b), a, a + out.length);
      return true;
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      if (s === en && !e.shiftKey) {
        edit(value.slice(0, s) + "  " + value.slice(en), s + 2);
        return true;
      }
      const [a, b] = lineBlock(s, en);
      const out = value.slice(a, b).split("\n").map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l)).join("\n");
      edit(value.slice(0, a) + out + value.slice(b), a, a + out.length);
      return true;
    }
    if (mod || e.altKey || e.nativeEvent.isComposing) return false;
    const next = value[en] ?? "";
    if (e.key in PAIRS) {
      const close = PAIRS[e.key];
      if (s !== en) {
        // wrap the selection
        edit(value.slice(0, s) + e.key + value.slice(s, en) + close + value.slice(en), s + 1, en + 1);
        return true;
      }
      if (e.key === "$" && next === "$") {
        edit(value, s + 1); // skip over the closing $ that is already there
        return true;
      }
      if (value[s - 1] === "\\") return false; // escapes such as \{ \$ are not paired
      if (next === "" || /\s/.test(next) || CLOSERS.has(next)) {
        edit(value.slice(0, s) + e.key + close + value.slice(en), s + 1);
        return true;
      }
      return false;
    }
    if (CLOSERS.has(e.key) && s === en && next === e.key) {
      edit(value, s + 1); // typing the closing bracket again skips over it
      return true;
    }
    if (e.key === "Backspace" && s === en && s > 0 && PAIRS[value[s - 1]] === next && next !== "") {
      edit(value.slice(0, s - 1) + value.slice(s + 1), s - 1); // delete an empty pair in one go
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nav = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key);
    if (!menu.open || !nav) {
      if (editKey(e)) e.preventDefault(); // editing shortcuts (bracket pairs etc.) — the menu is recomputed after edit()
      return;
    }
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
    <div data-editor-theme={dark ? "dark" : "light"} className={`relative min-h-0 flex-1 ${dark ? "bg-[#0F1115]" : "bg-white"}`}>
      {marks.length > 0 && (
        <div
          ref={markRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 overflow-hidden text-transparent ${TYPO}`}
        >
          <MarkLayer value={value} marks={marks} />
        </div>
      )}
      {hits.length > 0 && (
        <div ref={findRef} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden text-transparent ${TYPO}`}>
          <MarkLayer value={value} marks={hits} cls="bg-sky-300/45" testid="find-hit" />
        </div>
      )}
      <div
        ref={backRef}
        aria-hidden
        data-testid="latex-highlight"
        className={`pointer-events-none absolute inset-0 overflow-hidden ${dark ? "text-slate-200" : "text-ink"} ${TYPO}`}
      >
        <LatexHighlight value={value} dark={dark} />
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
        style={{ WebkitTextFillColor: "transparent", color: "transparent", caretColor: dark ? "#F1F1EF" : "#10131a" }}
        className={`absolute inset-0 block h-full w-full resize-none bg-transparent outline-none ${dark ? "selection:bg-sky-400/30" : "selection:bg-accent/20"} ${TYPO}`}
      />
      {/* find · replace */}
      {find.open && (
        <div data-testid="find-panel" className="absolute right-3 top-2 z-20 w-[min(92%,340px)] rounded-xl bg-white p-2 text-xs shadow-2xl ring-1 ring-black/10">
          <div className="flex items-center gap-1">
            <input
              ref={findInput}
              value={find.q}
              onChange={(e) => setFind((f) => ({ ...f, q: e.target.value, idx: 0 }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  gotoHit(cur + (e.shiftKey ? -1 : 1));
                } else if (e.key === "Escape") closeFind();
              }}
              placeholder="Find"
              aria-label="Find"
              className="min-w-0 flex-1 rounded-md border border-black/10 px-2 py-1.5 font-mono outline-none focus:border-accent"
            />
            <span data-testid="find-count" className="w-14 shrink-0 text-center tabular-nums text-ink/50">
              {find.q ? (hits.length ? `${cur + 1}/${hits.length}` : "No results") : ""}
            </span>
            <button type="button" aria-label="Previous result" onClick={() => gotoHit(cur - 1)} className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-black/5"><ChevronUp size={14} /></button>
            <button type="button" aria-label="Next result" onClick={() => gotoHit(cur + 1)} className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-black/5"><ChevronDown size={14} /></button>
            <button type="button" aria-label="Close find" onClick={closeFind} className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-black/5"><X size={14} /></button>
          </div>
          {find.replace ? (
            <div className="mt-1.5 flex items-center gap-1">
              <input
                value={find.r}
                onChange={(e) => setFind((f) => ({ ...f, r: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    replaceOne();
                  } else if (e.key === "Escape") closeFind();
                }}
                placeholder="Replace with"
                aria-label="Replace with"
                className="min-w-0 flex-1 rounded-md border border-black/10 px-2 py-1.5 font-mono outline-none focus:border-accent"
              />
              <button type="button" onClick={replaceOne} disabled={cur < 0} className="rounded-md px-2 py-1.5 font-medium text-ink/70 hover:bg-black/5 disabled:opacity-40">Replace</button>
              <button type="button" onClick={replaceAll} disabled={!hits.length} className="rounded-md px-2 py-1.5 font-medium text-ink/70 hover:bg-black/5 disabled:opacity-40">All</button>
            </div>
          ) : (
            <button type="button" onClick={() => setFind((f) => ({ ...f, replace: true }))} className="mt-1 px-1 text-[11px] text-ink/45 hover:text-accent">Open replace (Ctrl+H)</button>
          )}
        </div>
      )}
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
              <span className={`font-mono text-xs ${menu.mode === "key" ? "text-emerald-600" : "text-blue-600"}`}>
                {c.insert.split("\n")[0]}
                {c.insert.includes("\n") ? " …" : ""}
              </span>
              <span className={`ml-auto text-[11px] text-ink/45 ${menu.mode === "key" ? "min-w-0 truncate" : "shrink-0"}`}>{c.label}</span>
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
