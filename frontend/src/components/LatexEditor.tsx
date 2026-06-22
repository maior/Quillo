"use client";

import { RefObject, useMemo, useRef, useState } from "react";

/**
 * LaTeX 구문 강조 에디터 — 오버레이 방식.
 *
 * 실제 입력은 기존 textarea 가 그대로 받는다(자동 저장·스니펫 삽입·테스트 모두 무손상).
 * 글자색만 투명하게 하고, 뒤에 같은 타이포그래피의 레이어를 깔아
 * 커서·선택은 textarea, 색(구문)·형광(코멘트 구간)은 레이어가 담당한다. 의존성 없음.
 *
 * 추가 기능:
 * - marks: 코멘트가 달린 구간을 형광으로 표시
 * - 백슬래시(\) 자동완성: \ 를 입력하면 명령 후보가 떠서 ↑↓ + Enter 로 선택
 */

type Token = { text: string; kind: TokenKind };
type TokenKind = "command" | "comment" | "math" | "brace" | "special" | "env" | "plain";

// 색은 라이트 테마 기준 — 본문(ink)과 또렷이 구분되는 5계열
const TOKEN_CLS: Record<TokenKind, string> = {
  command: "text-blue-600",
  comment: "italic text-slate-400",
  math: "text-purple-600",
  brace: "text-amber-600",
  special: "text-rose-600",
  env: "font-semibold text-emerald-600",
  plain: "",
};

// 한 번의 순차 스캔 — \% 가 주석으로 오인되지 않도록 명령을 먼저 매칭
const TOKEN_RE =
  /(\\(?:[a-zA-Z@]+\*?|.))|(%[^\n]*)|(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)|([{}[\]])|([&^_~])/g;

export function tokenizeLatex(src: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let pendingEnv = false; // 직전 토큰이 \begin/\end — 다음 {이름} 을 env 로
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
      // \begin{figure} 의 환경 이름을 강조
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

// textarea 와 레이어가 픽셀 단위로 겹치도록 타이포그래피를 한 곳에서 정의
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
      {"\n" /* 마지막 줄 높이 유지 */}
    </>
  );
}

// ── 코멘트 마크 레이어 — 글자는 투명, 구간 배경만 형광 ──
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

// ── 백슬래시 자동완성 명령 사전 ──
type Command = { insert: string; label: string };
const C = (insert: string, label: string): Command => ({ insert, label });
const COMMANDS: Command[] = [
  C("\\section{}", "절 제목"),
  C("\\subsection{}", "소절 제목"),
  C("\\subsubsection{}", "소소절 제목"),
  C("\\textbf{}", "굵게"),
  C("\\textit{}", "기울임"),
  C("\\emph{}", "강조"),
  C("\\underline{}", "밑줄"),
  C("\\texttt{}", "고정폭"),
  C("\\cite{}", "문헌 인용"),
  C("\\ref{}", "교차 참조"),
  C("\\label{}", "라벨"),
  C("\\caption{}", "캡션"),
  C("\\footnote{}", "각주"),
  C("\\frac{}{}", "분수"),
  C("\\sqrt{}", "제곱근"),
  C("\\sum_{}^{}", "합 Σ"),
  C("\\int_{}^{}", "적분 ∫"),
  C("\\includegraphics[width=\\linewidth]{}", "그림 삽입"),
  C(
    "\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}",
    "그림 환경",
  ),
  C(
    "\\begin{table}[ht]\n  \\caption{}\n  \\centering\n  \\begin{tabular}{lcc}\n    \\hline\n     &  &  \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}",
    "표 환경",
  ),
  C("\\begin{equation}\n  \n\\end{equation}", "수식 환경"),
  C("\\begin{itemize}\n  \\item \n\\end{itemize}", "글머리 목록"),
  C("\\begin{enumerate}\n  \\item \n\\end{enumerate}", "번호 목록"),
  C("\\begin{abstract}\n\n\\end{abstract}", "초록"),
  C("\\item ", "목록 항목"),
  C("\\maketitle", "제목 생성"),
  C("\\tableofcontents", "목차"),
  C("\\usepackage{}", "패키지 로드"),
  C("\\input{}", "파일 포함"),
  C("\\centering", "가운데 정렬"),
  C("\\textsuperscript{}", "위 첨자"),
  C("\\textsubscript{}", "아래 첨자"),
  C("\\textcolor{}{}", "글자색"),
  C("\\alpha", "α"),
  C("\\beta", "β"),
  C("\\gamma", "γ"),
  C("\\delta", "δ"),
  C("\\sigma", "σ"),
  C("\\mu", "µ"),
  C("\\circ", "° (원 기호)"),
  C("\\times", "×"),
  C("\\pm", "±"),
  C("\\leq", "≤"),
  C("\\geq", "≥"),
  C("\\hline", "표 가로줄"),
  C("\\newpage", "쪽 나눔"),
  C("\\noindent", "들여쓰기 없음"),
  C("\\vspace{}", "세로 간격"),
  C("\\hspace{}", "가로 간격"),
];

function caretInInsert(insert: string): number {
  const brace = insert.indexOf("{}");
  if (brace >= 0) return brace + 1;
  const blank = insert.indexOf("\n  \n");
  if (blank >= 0) return blank + 3;
  return insert.length;
}

/** textarea 캐럿의 픽셀 좌표 — 동일 타이포그래피 미러로 측정 */
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
  start: number; // '\' 의 인덱스
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

  // 캐럿 직전의 "\prefix" 를 찾는다 — "\\"(줄바꿈 명령) 뒤에서는 열지 않음
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
    // 캐럿이 메뉴 트리거 위치를 벗어나면 닫는다
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
      {/* 명령 자동완성 메뉴 */}
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
                e.preventDefault(); // blur 로 메뉴가 닫히기 전에 적용
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
            ↑↓ 이동 · Enter 선택 · Esc 닫기
          </p>
        </div>
      )}
    </div>
  );
}
