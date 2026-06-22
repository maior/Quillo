"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode,
  FileImage,
  FilePlus,
  FileText,
  History,
  KeyRound,
  LayoutTemplate,
  Folder,
  FolderPlus,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  Printer,
  RefreshCw,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { authApi, authFetch } from "@/lib/api";
import PdfViewer from "@/components/PdfViewer";
import LatexToolbar from "@/components/LatexToolbar";
import LatexEditor, { LatexHighlight } from "@/components/LatexEditor";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8675";

interface Paper {
  id: number;
  key: string; // 외부 노출용 해시 키
  mine: boolean; // 내가 소유자
  title: string;
  status: string;
  journal: string;
  created_by: string;
  updated_by: string;
  updated_at: string;
  lock_user_name: string;
  locked: boolean;
  lock_mine: boolean;
}

interface PFile {
  id: number;
  path: string;
  kind: "text" | "image" | "folder";
  storage: string;
}

interface Template {
  key: string;
  name: string;
  publisher: string;
  kind: string;
  columns: number; // 1=1단, 2=2단
  description: string;
}

// 레이아웃 뱃지 — 목록에서 단 구성을 한눈에 구분
function layoutBadge(t: Template) {
  if (t.kind === "presentation")
    return { label: `슬라이드`, cls: "bg-amber-50 text-amber-600" };
  if (t.columns === 2) return { label: `2단`, cls: "bg-accent/10 text-accent" };
  return { label: `1단`, cls: "bg-ink/5 text-ink/50" };
}

const STATUSES = [
  { value: "draft", label: "초안" },
  { value: "submitted", label: "투고" },
  { value: "revision", label: "리비전" },
  { value: "published", label: "게재" },
];

// ── 트리 구성 ──
type TreeNode = {
  name: string;
  path: string;
  file?: PFile; // folder 행 또는 파일
  children: TreeNode[];
};

function buildTree(files: PFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  const ensure = (path: string): TreeNode => {
    const parts = path.split("/");
    let node = root;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.find((c) => c.path === acc);
      if (!child) {
        child = { name: part, path: acc, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const f of files) ensure(f.path).file = f;
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const aFolder = a.children.length > 0 || a.file?.kind === "folder";
      const bFolder = b.children.length > 0 || b.file?.kind === "folder";
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

function revTime(iso: string) {
  return iso.slice(5, 16).replace("T", " "); // "06-12 14:30"
}

function fileIcon(node: TreeNode) {
  if (node.children.length > 0 || node.file?.kind === "folder") return Folder;
  if (node.file?.kind === "image") return FileImage;
  if (node.name.endsWith(".tex") || node.name.endsWith(".bib")) return FileCode;
  return FileText;
}

export default function PaperEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [files, setFiles] = useState<PFile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [meta, setMeta] = useState({ title: "", status: "draft", journal: "" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<"text" | "folder" | null>(null);
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{ url?: string; bytes?: ArrayBuffer; error?: string } | null>(null);
  const [me, setMe] = useState<{ id: number; name: string; email: string; role: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // ── 리뷰 코멘트 ──
  interface PComment {
    id: number;
    file_id: number;
    author_id: number;
    author_name: string;
    quote: string;
    anchor: number;
    body: string;
    status: string;
    created_at: string;
  }
  const [comments, setComments] = useState<PComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState<{ start: number; end: number; quote: string } | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const preRef = useRef<HTMLPreElement>(null);

  const loadComments = useCallback(async () => {
    setComments(await authFetch<PComment[]>(`/api/papers/${id}/comments`));
  }, [id]);

  // 코멘트 구간의 현재 위치 — quote 를 anchor 근처에서 탐색 (본문이 바뀌면 못 찾을 수 있음)
  const locateQuote = useCallback(
    (c: PComment): number => {
      if (!c.quote) return -1;
      let idx = content.indexOf(c.quote, Math.max(0, c.anchor - 200));
      if (idx < 0) idx = content.indexOf(c.quote);
      return idx;
    },
    [content],
  );

  const startComment = () => {
    if (!selRange || selRange.end <= selRange.start) return;
    setHistoryOpen(false);
    setPreviewPct((p) => Math.min(p, 34));
    setDraft({
      start: selRange.start,
      end: selRange.end,
      quote: content.slice(selRange.start, selRange.end).slice(0, 300),
    });
    setDraftBody("");
    setCommentsOpen(true);
  };

  const submitComment = async () => {
    if (!draft || !draftBody.trim() || !active) return;
    try {
      await authFetch(`/api/papers/${id}/comments`, {
        method: "POST",
        json: { file_id: active.id, quote: draft.quote, anchor: draft.start, body: draftBody },
      });
      setDraft(null);
      setDraftBody("");
      setSelRange(null);
      await loadComments();
    } catch (e) {
      flash(e instanceof Error ? e.message : "코멘트 등록에 실패했습니다.");
    }
  };

  const toggleResolve = async (c: PComment) => {
    await authFetch(`/api/papers/${id}/comments/${c.id}`, {
      method: "PUT",
      json: { status: c.status === "open" ? "resolved" : "open" },
    });
    await loadComments();
  };

  const deleteComment = async (c: PComment) => {
    if (!confirm("이 코멘트를 삭제할까요?")) return;
    await authFetch(`/api/papers/${id}/comments/${c.id}`, { method: "DELETE" });
    await loadComments();
  };

  const jumpToComment = (c: PComment) => {
    const idx = locateQuote(c);
    if (idx < 0 || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.focus();
    ta.setSelectionRange(idx, idx + c.quote.length);
    const line = content.slice(0, idx).split("\n").length;
    ta.scrollTop = Math.max(0, (line - 4) * 21.1); // leading-relaxed(13px×1.625)
  };

  // 읽기 전용 보기에서도 선택 → 코멘트 (리뷰어는 잠금 없이 코멘트만 남긴다)
  const readSelection = () => {
    const sel = window.getSelection();
    const pre = preRef.current;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !pre) return setSelRange(null);
    const range = sel.getRangeAt(0);
    if (!pre.contains(range.startContainer) || !pre.contains(range.endContainer))
      return setSelRange(null);
    const before = range.cloneRange();
    before.selectNodeContents(pre);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    setSelRange({ start, end: start + range.toString().length });
  };
  const [compiling, setCompiling] = useState(false);
  const [previewPct, setPreviewPct] = useState(46); // 분할바로 조절되는 미리보기 폭(%)
  const splitRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── 템플릿 모달 ──
  const [tplOpen, setTplOpen] = useState(false);
  const [tplList, setTplList] = useState<Template[]>([]);
  const [tplSelected, setTplSelected] = useState<string | null>(null);
  const [tplPreview, setTplPreview] = useState<ArrayBuffer | null>(null);
  const [tplBusy, setTplBusy] = useState(false);

  const openTemplates = async () => {
    setTplOpen(true);
    const list = await authFetch<Template[]>("/api/templates");
    setTplList(list);
    if (list.length) void selectTemplate(list[0].key);
  };

  const selectTemplate = async (key: string) => {
    setTplSelected(key);
    setTplPreview(null);
    setTplBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/templates/${key}/preview`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) setTplPreview(await res.arrayBuffer());
    } finally {
      setTplBusy(false);
    }
  };

  const applyTemplate = async () => {
    if (!tplSelected) return;
    if (!confirm("main.tex 가 이 템플릿 골격으로 교체됩니다. 진행할까요?")) return;
    setTplBusy(true);
    try {
      await authFetch(`/api/papers/${id}/apply-template`, {
        method: "POST",
        json: { key: tplSelected },
      });
      setTplOpen(false);
      const fs = await loadAll();
      const main = fs.find((f) => f.path === "main.tex");
      if (main) await openFile(main);
      void compile();
      flash("템플릿이 적용되었습니다.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "템플릿 적용에 실패했습니다.");
    } finally {
      setTplBusy(false);
    }
  };

  // ── 공유·편집 초대 모달 ──
  interface Collaborator {
    user_id: number;
    name: string;
    email: string;
  }
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInfo, setShareInfo] = useState<{
    owner: { user_id: number; name: string };
    collaborators: Collaborator[];
    can_invite: boolean;
  } | null>(null);
  const [directory, setDirectory] = useState<{ id: number; name: string; email: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareBusy, setShareBusy] = useState(false);

  const loadShare = async () => {
    const info = await authFetch<typeof shareInfo>(`/api/papers/${id}/collaborators`);
    setShareInfo(info);
    return info;
  };

  const openShare = async () => {
    setShareOpen(true);
    setInviteEmail("");
    const [info, users] = await Promise.all([
      loadShare(),
      authFetch<{ id: number; name: string; email: string }[]>("/api/auth/users"),
    ]);
    const taken = new Set([info!.owner.user_id, ...info!.collaborators.map((c) => c.user_id)]);
    setDirectory(users.filter((u) => !taken.has(u.id)));
  };

  const invite = async () => {
    if (!inviteEmail) return;
    setShareBusy(true);
    try {
      await authFetch(`/api/papers/${id}/collaborators`, {
        method: "POST",
        json: { email: inviteEmail },
      });
      setInviteEmail("");
      const info = await loadShare();
      setDirectory((d) => d.filter((u) => !info!.collaborators.some((c) => c.user_id === u.id)));
      flash("초대했습니다.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "초대에 실패했습니다.");
    } finally {
      setShareBusy(false);
    }
  };

  const removeCollaborator = async (c: Collaborator) => {
    if (!confirm(`${c.name} 님의 편집 권한을 해제할까요?`)) return;
    await authFetch(`/api/papers/${id}/collaborators/${c.user_id}`, { method: "DELETE" });
    await loadShare();
  };

  // ── 버전 히스토리 ──
  interface RevMeta {
    id: number;
    file_id: number;
    path: string;
    author_name: string;
    created_at: string;
    added: number;
    removed: number;
    first: boolean;
  }
  interface RevDetail {
    id: number;
    file_id: number;
    path: string;
    author_name: string;
    created_at: string;
    diff: { op: string; text: string }[];
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<RevMeta[] | null>(null);
  const [viewRev, setViewRev] = useState<RevDetail | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryList(await authFetch<RevMeta[]>(`/api/papers/${id}/history`));
  }, [id]);

  const openHistory = () => {
    setCommentsOpen(false);
    setHistoryOpen(true);
    setPreviewPct((p) => Math.min(p, 34)); // 패널이 열리면 미리보기가 폭을 양보 — 에디터 압사 방지
    void loadHistory();
  };

  const openRevision = async (rev: RevMeta) => {
    setViewRev(await authFetch<RevDetail>(`/api/papers/${id}/history/${rev.id}`));
  };

  const restoreRevision = async (rev: RevDetail) => {
    if (!confirm(`${rev.path} 를 ${revTime(rev.created_at)} 버전으로 되돌릴까요?`)) return;
    try {
      const r = await authFetch<{ file_id: number }>(
        `/api/papers/${id}/history/${rev.id}/restore`,
        { method: "POST" },
      );
      setViewRev(null);
      const fs = await loadAll();
      const f = fs.find((x) => x.id === r.file_id);
      if (f) await openFile(f);
      flash("해당 버전으로 되돌렸습니다.");
      void compile();
    } catch (e) {
      flash(e instanceof Error ? e.message : "되돌리기에 실패했습니다.");
    }
  };

  // ── 외부 API 액세스 모달 (Claude Code 등 외부 도구 연동) ──
  const [apiOpen, setApiOpen] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<{ has_token: boolean; prefix?: string } | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  const openApi = async () => {
    setApiOpen(true);
    setIssuedToken(null);
    setTokenStatus(await authFetch<{ has_token: boolean; prefix?: string }>("/api/auth/token"));
  };

  const issueToken = async () => {
    if (tokenStatus?.has_token && !confirm("기존 토큰은 즉시 무효화됩니다. 재발급할까요?")) return;
    setApiBusy(true);
    try {
      const r = await authFetch<{ token: string }>("/api/auth/token", { method: "POST" });
      setIssuedToken(r.token);
      setTokenStatus(await authFetch<{ has_token: boolean; prefix?: string }>("/api/auth/token"));
      // 놓치고 닫는 일이 없도록 발급 즉시 클립보드에 복사
      try {
        await navigator.clipboard.writeText(r.token);
        flash("토큰이 클립보드에 복사되었습니다.");
      } catch {
        /* 클립보드 권한 없으면 복사 버튼으로 */
      }
    } finally {
      setApiBusy(false);
    }
  };

  const revokeToken = async () => {
    if (!confirm("토큰을 폐기하면 외부 도구의 접근이 즉시 차단됩니다. 폐기할까요?")) return;
    await authFetch("/api/auth/token", { method: "DELETE" });
    setIssuedToken(null);
    setTokenStatus({ has_token: false });
  };

  // 도구 모음 삽입 — 선택 영역이 있으면 감싸고, 없으면 placeholder 위치에 커서
  const insertSnippet = (before: string, after = "", placeholder = "") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart ?? content.length;
    const e = ta.selectionEnd ?? s;
    const selected = content.slice(s, e);
    const mid = selected || placeholder;
    const next = content.slice(0, s) + before + mid + after + content.slice(e);
    setContent(next);
    setDirty(true);
    requestAnimationFrame(() => {
      ta.focus();
      if (selected) {
        const pos = s + before.length + mid.length + after.length;
        ta.setSelectionRange(pos, pos);
      } else {
        // placeholder(또는 빈 칸)를 선택 상태로 — 바로 타이핑하면 덮어쓰기
        ta.setSelectionRange(s + before.length, s + before.length + mid.length);
      }
    });
  };

  const active = files.find((f) => f.id === activeId) ?? null;
  const editable = paper?.lock_mine ?? false;

  const loadAll = useCallback(async () => {
    const [p, fs] = await Promise.all([
      authFetch<Paper>(`/api/papers/${id}`),
      authFetch<PFile[]>(`/api/papers/${id}/files`),
    ]);
    setPaper(p);
    setFiles(fs);
    setMeta({ title: p.title, status: p.status, journal: p.journal });
    return fs;
  }, [id]);

  const didAutoCompile = useRef(false);

  useEffect(() => {
    authApi
      .me()
      .then(async (u) => {
        setMe(u);
        const fs = await loadAll();
        void loadComments();
        const main = fs.find((f) => f.path === "main.tex") ?? fs.find((f) => f.kind === "text");
        if (main) await openFile(main);
        // 미리보기는 상시 패널 — 열 때 한 번 자동 컴파일해 바로 보여준다
        if (!didAutoCompile.current) {
          didAutoCompile.current = true;
          void compile();
        }
      })
      .catch(() => router.replace("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openFile = async (f: PFile) => {
    if (f.kind === "folder") return;
    setActiveId(f.id);
    setDirty(false);
    if (f.kind === "text") {
      const detail = await authFetch<{ content: string }>(`/api/papers/${id}/files/${f.id}`);
      setContent(detail.content);
    }
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2500);
  };

  const startEdit = async () => {
    try {
      await authFetch(`/api/papers/${id}/lock`, { method: "POST" });
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : "잠금 획득에 실패했습니다.");
    }
  };

  const saveFile = useCallback(
    async (quiet = false) => {
      if (!active || active.kind !== "text") return;
      try {
        await authFetch(`/api/papers/${id}/files/${active.id}`, {
          method: "PUT",
          json: { content },
        });
        setDirty(false);
        if (!quiet) flash("저장되었습니다.");
      } catch (e) {
        flash(e instanceof Error ? e.message : "저장에 실패했습니다.");
      }
    },
    [active, content, id],
  );

  // 화면 이탈 시 잠금 자동 해제 — 떠난 사람이 30분 TTL 동안 다른 멤버를 막지 않도록.
  // 탭 전환은 유지하고, 에디터를 실제로 떠날 때(라우팅 이동·탭 닫기)만 해제한다.
  const editableRef = useRef(false);
  const dirtyRef = useRef(false);
  const activeRef = useRef<PFile | null>(null);
  const contentRef = useRef("");
  useEffect(() => { editableRef.current = editable; }, [editable]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { activeRef.current = active ?? null; }, [active]);
  useEffect(() => { contentRef.current = content; }, [content]);

  useEffect(() => {
    const releaseLock = () => {
      if (!editableRef.current) return;
      editableRef.current = false; // 중복 해제 방지
      const base = `${API_BASE}/api/papers/${id}`;
      const f = activeRef.current;
      // 마지막 입력이 자동 저장(2.5s) 전이면 떠나기 직전에 저장
      if (dirtyRef.current && f && f.kind === "text") {
        void fetch(`${base}/files/${f.id}`, {
          method: "PUT",
          credentials: "include",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: contentRef.current }),
        });
      }
      void fetch(`${base}/unlock`, { method: "POST", credentials: "include", keepalive: true });
    };
    window.addEventListener("pagehide", releaseLock); // 탭 닫기·새로고침
    return () => {
      window.removeEventListener("pagehide", releaseLock);
      releaseLock(); // SPA 내 다른 화면으로 이동 (언마운트)
    };
  }, [id]);

  // 자동 저장 — 타이핑이 멈추고 2.5초 뒤 조용히 저장 (저장 버튼 없음)
  useEffect(() => {
    if (!editable || !dirty) return;
    const t = setTimeout(() => void saveFile(true), 2500);
    return () => clearTimeout(t);
  }, [content, editable, dirty, saveFile]);

  // ⌘S/Ctrl+S = 컴파일 (저장은 자동이므로 단축키는 조판 갱신에)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void compile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, dirty, content, meta]);

  const saveMetaAndUnlock = async (release: boolean) => {
    setBusy(true);
    try {
      if (dirty) await saveFile();
      await authFetch(`/api/papers/${id}`, { method: "PUT", json: meta });
      if (release) await authFetch(`/api/papers/${id}/unlock`, { method: "POST" });
      await loadAll();
      flash(release ? "저장 후 편집을 종료했습니다." : "저장되었습니다.");
    } finally {
      setBusy(false);
    }
  };

  const createEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim() || !creating) return;
    try {
      const f = await authFetch<PFile>(`/api/papers/${id}/files`, {
        method: "POST",
        json: { path: newPath.trim(), kind: creating },
      });
      setCreating(null);
      setNewPath("");
      await loadAll();
      if (f.kind === "text") await openFile(f);
    } catch (err) {
      flash(err instanceof Error ? err.message : "생성에 실패했습니다.");
    }
  };

  // 트리 내부 드래그 이동 — 파일/폴더를 폴더(또는 최상위)로
  const [dropTarget, setDropTarget] = useState<string | null>(null); // 폴더 path, "" = 최상위

  const moveEntry = async (fileId: number, folder: string) => {
    const f = files.find((x) => x.id === fileId);
    if (!f) return;
    const base = f.path.split("/").pop()!;
    const newPath = folder ? `${folder}/${base}` : base;
    if (newPath === f.path) return;
    try {
      await authFetch(`/api/papers/${id}/files/${fileId}`, {
        method: "PUT",
        json: { path: newPath },
      });
      await loadAll();
      flash(`'${base}' 을(를) ${folder || "최상위"}로 옮겼습니다.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "이동에 실패했습니다.");
    }
  };

  const removeEntry = async (f: PFile) => {
    if (!confirm(`'${f.path}' 을(를) 삭제할까요?${f.kind === "folder" ? " 폴더 안 파일도 함께 삭제됩니다." : ""}`)) return;
    await authFetch(`/api/papers/${id}/files/${f.id}`, { method: "DELETE" });
    if (activeId === f.id) setActiveId(null);
    await loadAll();
  };

  const uploadFiles = async (list: FileList | File[], folder = "") => {
    for (const file of Array.from(list)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch(`${API_BASE}/api/papers/${id}/files/upload`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        flash(d.detail ?? `${file.name} 업로드 실패`);
      }
    }
    await loadAll();
  };

  const [compiledEntry, setCompiledEntry] = useState("main.tex");

  const compile = async () => {
    setCompiling(true);
    try {
      // 컴파일 = 저장 + 조판: 본문과 메타(제목·상태·저널)를 먼저 반영
      if (editable) {
        if (dirty) await saveFile(true);
        await authFetch(`/api/papers/${id}`, { method: "PUT", json: meta });
      }
      // 활성 파일 기준 미리보기 — 섹션 파일이면 main 프리앰블을 빌려 그 파일만 조판
      const entry = active?.kind === "text" ? active.path : "main.tex";
      const res = await fetch(
        `${API_BASE}/api/papers/${id}/compile?entry=${encodeURIComponent(entry)}`,
        { method: "POST", credentials: "include" },
      );
      setCompiledEntry(entry);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPreview({ error: d.detail ?? "컴파일에 실패했습니다." });
        return;
      }
      const bytes = await res.arrayBuffer();
      if (preview?.url) URL.revokeObjectURL(preview.url);
      // url 은 다운로드·인쇄용, bytes 는 pdf.js 렌더용
      setPreview({
        url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
        bytes,
      });
    } finally {
      setCompiling(false);
      if (historyOpen) void loadHistory(); // 컴파일 = 체크포인트 — 열린 패널 갱신
    }
  };

  // 분할바 드래그 — 미리보기 폭 25~70% 범위에서 조절
  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const root = splitRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      setPreviewPct(Math.min(70, Math.max(25, pct)));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const exportZip = async () => {
    const res = await fetch(`${API_BASE}/api/papers/${id}/export`, { credentials: "include" });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(paper?.title ?? "paper").replace(/\s+/g, "_")}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tree = useMemo(() => buildTree(files), [files]);

  // 열린 코멘트의 현재 구간 — 마크 레이어로 형광 표시 (본문 변경으로 못 찾으면 제외)
  const commentMarks = useMemo(() => {
    if (!active) return [];
    return comments
      .filter((c) => c.file_id === active.id && c.status === "open")
      .map((c) => {
        const idx = locateQuote(c);
        return idx >= 0 ? { start: idx, end: idx + c.quote.length } : null;
      })
      .filter((m): m is { start: number; end: number } => m !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, content, active?.id]);

  const fileComments = active ? comments.filter((c) => c.file_id === active.id) : [];
  const openCount = comments.filter((c) => c.status === "open").length;

  if (!paper) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isFolder = node.children.length > 0 || node.file?.kind === "folder";
    const Icon = fileIcon(node);
    const isCollapsed = collapsed.has(node.path);
    const isActive = node.file != null && node.file.id === activeId;
    return (
      <div key={node.path}>
        <div
          onClick={() => {
            if (isFolder) {
              setCollapsed((s) => {
                const next = new Set(s);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
            } else if (node.file) {
              void openFile(node.file);
            }
          }}
          draggable={editable && node.file != null}
          onDragStart={(e) => {
            if (!editable || !node.file) return;
            e.dataTransfer.setData("application/x-quillo-file", String(node.file.id));
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={
            isFolder && editable
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropTarget(node.path);
                }
              : undefined
          }
          onDragLeave={
            isFolder && editable
              ? () => setDropTarget((cur) => (cur === node.path ? null : cur))
              : undefined
          }
          onDrop={
            isFolder && editable
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropTarget(null);
                  setDragging(false);
                  const fid = e.dataTransfer.getData("application/x-quillo-file");
                  if (fid) void moveEntry(Number(fid), node.path);
                  // OS 파일을 폴더 위에 떨어뜨리면 그 폴더로 업로드
                  else if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files, node.path);
                }
              : undefined
          }
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`group flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-[13px] transition ${
            isActive ? "bg-accent/10 font-semibold text-accent" : "text-white/70 hover:bg-white/5 hover:text-white"
          } ${dropTarget === node.path ? "bg-accent-cyan/15 ring-1 ring-inset ring-accent-cyan/50" : ""}`}
        >
          {isFolder ? (
            isCollapsed ? <ChevronRight size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />
          ) : (
            <span className="w-3" />
          )}
          <Icon size={14} className={`shrink-0 ${isFolder ? "text-amber-400/80" : isActive ? "" : "text-white/40"}`} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {editable && node.file && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void removeEntry(node.file!);
              }}
              aria-label={`${node.path} 삭제`}
              className="hidden h-5 w-5 shrink-0 place-items-center rounded text-white/30 transition hover:text-red-400 group-hover:grid"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
        {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-gray-100/80">
      {/* ── 상단 바 — Overleaf 풍 다크 헤더 ── */}
      <div
        data-testid="editor-topbar"
        className="relative z-20 flex flex-wrap items-center gap-2.5 border-b border-white/10 bg-ink px-4 py-2.5"
      >
        <Link
          href="/papers"
          title="내 원고 목록으로 나가기"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={16} />
        </Link>
        <span className="hidden h-5 w-px bg-white/10 sm:block" />
        {editable ? (
          <input
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            className="min-w-64 flex-1 rounded-lg border border-white/15 bg-white/[0.07] px-3 py-1.5 font-display text-sm font-bold text-white outline-none placeholder:text-white/30 focus:border-accent-cyan/60"
          />
        ) : (
          <h1 className="flex-1 truncate font-display text-base font-bold text-white">{paper.title}</h1>
        )}

        {editable && (
          <>
            <select
              value={meta.status}
              onChange={(e) => setMeta({ ...meta, status: e.target.value })}
              className="rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1.5 text-xs text-white outline-none [&>option]:text-ink focus:border-accent-cyan/60"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <input
              value={meta.journal}
              onChange={(e) => setMeta({ ...meta, journal: e.target.value })}
              placeholder="타깃 저널"
              className="w-40 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent-cyan/60"
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {notice && <span className="mr-1 text-xs font-medium text-accent-cyan">{notice}</span>}
          <button
            onClick={() => void compile()}
            disabled={compiling}
            title="저장 + 조판 (⌘S)"
            className="btn rounded-full bg-accent !px-4 !py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)] hover:bg-accent/90 disabled:opacity-60"
          >
            {compiling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 컴파일
          </button>
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <button
            onClick={exportZip}
            title="프로젝트 ZIP 다운로드"
            className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Download size={13} /> ZIP
          </button>
          <button
            onClick={() => {
              setCommentsOpen(false);
              if (historyOpen) setHistoryOpen(false);
              else openHistory();
            }}
            title="버전 히스토리 (컴파일할 때마다 기록)"
            data-testid="toggle-history"
            className={`btn rounded-full border !px-3.5 !py-1.5 text-xs ${
              historyOpen
                ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                : "border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <History size={13} /> 히스토리
          </button>
          <button
            onClick={() => {
              setHistoryOpen(false);
              setCommentsOpen((v) => {
                if (!v) setPreviewPct((p) => Math.min(p, 34));
                return !v;
              });
            }}
            title="리뷰 코멘트"
            data-testid="toggle-comments"
            className={`btn rounded-full border !px-3.5 !py-1.5 text-xs ${
              commentsOpen
                ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                : "border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <MessageSquare size={13} /> 코멘트
            {openCount > 0 && (
              <span className="rounded-full bg-accent-cyan/20 px-1.5 text-[10px] font-bold text-accent-cyan">
                {openCount}
              </span>
            )}
          </button>
          <button
            onClick={() => void openShare()}
            title="멤버 초대·공유"
            className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Users size={13} /> 공유
          </button>
          <button
            onClick={() => void openApi()}
            title="외부 API·토큰"
            className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            <KeyRound size={13} /> API
          </button>
          {editable ? (
            <>
              <button
                onClick={() => void openTemplates()}
                title="저널·학회 템플릿"
                className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LayoutTemplate size={13} /> 템플릿
              </button>
              <button
                onClick={() => void saveMetaAndUnlock(true)}
                disabled={busy}
                className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LockOpen size={13} /> 편집 종료
              </button>
            </>
          ) : paper.locked ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3.5 py-1.5 text-xs font-semibold text-amber-300">
              <Lock size={12} /> {paper.lock_user_name}님 편집 중
            </span>
          ) : (
            <button
              onClick={startEdit}
              className="btn rounded-full bg-white !px-4 !py-1.5 text-xs font-semibold text-ink hover:bg-white/90"
            >
              <Lock size={13} /> 편집 시작
            </button>
          )}

          {/* 사용자 메뉴 */}
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              data-testid="user-menu"
              aria-label="사용자 메뉴"
              className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-cyan text-xs font-bold text-white ring-2 ring-white/15 transition hover:ring-white/35"
            >
              {(me?.name || me?.email || "?").slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div
                  data-testid="user-dropdown"
                  className="absolute right-0 top-10 z-40 w-64 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
                >
                  <div className="border-b border-black/5 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-ink">{me?.name || "멤버"}</p>
                    <p className="truncate text-xs text-ink/45">{me?.email}</p>
                  </div>
                  <div className="py-1.5">
                    <Link
                      href="/papers"
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                    >
                      <FileText size={14} className="text-ink/35" /> 내 원고 목록
                    </Link>
                    <Link
                      href="/lounge"
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                    >
                      <Users size={14} className="text-ink/35" /> 멤버 라운지
                    </Link>
                    {me?.role === "admin" && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                      >
                        <Lock size={14} className="text-ink/35" /> 관리자 콘솔
                      </Link>
                    )}
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void openApi();
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                    >
                      <KeyRound size={14} className="text-ink/35" /> 설정 · API 토큰
                    </button>
                  </div>
                  <div className="border-t border-black/5 py-1.5">
                    <button
                      onClick={async () => {
                        // 세션이 사라지기 전에 잠금을 풀어준다 (이후 unmount 해제는 401 이라 무효)
                        if (editable) {
                          editableRef.current = false;
                          await authFetch(`/api/papers/${id}/unlock`, { method: "POST" }).catch(() => {});
                        }
                        await authApi.logout();
                        router.replace("/login");
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-red-500 transition hover:bg-red-50"
                    >
                      <ArrowLeft size={14} /> 로그아웃
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 템플릿 선택 모달 ── */}
      {tplOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-lightbox-fade">
          <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setTplOpen(false)} />
          <div
            data-testid="template-modal"
            className="relative flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-lightbox-zoom"
          >
            {/* 좌: 템플릿 리스트 */}
            <div className="flex w-80 shrink-0 flex-col border-r border-black/5">
              <div className="border-b border-black/5 px-5 py-4">
                <h2 className="font-display text-base font-bold text-ink">저널·학회 템플릿</h2>
                <p className="mt-0.5 text-xs text-ink/45">{`${tplList.length}종 · 적용 즉시 컴파일이 보장됩니다`}</p>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                {tplList.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => void selectTemplate(t.key)}
                    className={`block w-full rounded-xl border p-3.5 text-left transition ${
                      tplSelected === t.key
                        ? "border-accent/50 bg-accent/5"
                        : "border-black/5 hover:border-accent/25"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/50">
                        {t.publisher}
                      </span>
                      <span
                        data-testid="layout-badge"
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${layoutBadge(t).cls}`}
                      >
                        {layoutBadge(t).label}
                      </span>
                    </span>
                    <p className="mt-1.5 text-sm font-semibold text-ink">{t.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink/50">{t.description}</p>
                  </button>
                ))}
              </div>
              <div className="flex gap-2 border-t border-black/5 p-4">
                <button
                  onClick={() => void applyTemplate()}
                  disabled={tplBusy || !tplSelected}
                  className="btn-primary flex-1 !py-2.5 text-sm disabled:opacity-50"
                >
                  {tplBusy ? <Loader2 size={14} className="animate-spin" /> : <LayoutTemplate size={14} />}
                  이 템플릿 적용
                </button>
                <button
                  onClick={() => setTplOpen(false)}
                  className="btn rounded-full border border-black/10 px-5 text-sm text-ink/60 hover:bg-gray-50"
                >
                  취소
                </button>
              </div>
            </div>
            {/* 우: 조판 미리보기 */}
            <div className="flex min-w-0 flex-1 flex-col bg-gray-200/70">
              <div className="border-b border-black/5 bg-white px-4 py-2 text-xs font-semibold text-ink/55">
                조판 미리보기
              </div>
              {tplPreview ? (
                <div data-testid="template-preview" className="flex min-h-0 flex-1 flex-col">
                  <PdfViewer data={tplPreview} />
                </div>
              ) : (
                <div className="grid flex-1 place-items-center text-sm text-ink/40">
                  {tplBusy ? <Loader2 size={18} className="animate-spin text-accent" /> : "템플릿을 선택하세요"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 공유·편집 초대 모달 ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-lightbox-fade">
          <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setShareOpen(false)} />
          <div
            data-testid="share-modal"
            className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-lightbox-zoom"
          >
            <div className="border-b border-black/5 px-6 py-4">
              <h2 className="font-display text-base font-bold text-ink">공유 · 편집 초대</h2>
              <p className="mt-0.5 text-xs text-ink/45">
                이 원고는 소유자와 초대된 멤버만 볼 수 있습니다
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {shareInfo && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-ink/55">소유자</p>
                    <p className="mt-1.5 text-sm font-medium text-ink">{shareInfo.owner.name}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-ink/55">
                      {`초대된 멤버 (${shareInfo.collaborators.length})`}
                    </p>
                    {shareInfo.collaborators.length === 0 ? (
                      <p className="mt-1.5 text-xs text-ink/45">
                        아직 초대한 멤버가 없습니다. 아래에서 함께 쓸 멤버를 초대하세요.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {shareInfo.collaborators.map((c) => (
                          <li
                            key={c.user_id}
                            data-testid="collaborator-row"
                            className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                              <p className="truncate text-xs text-ink/45">{c.email}</p>
                            </div>
                            {shareInfo.can_invite && (
                              <button
                                onClick={() => void removeCollaborator(c)}
                                aria-label={`${c.name} 초대 해제`}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/35 transition hover:bg-red-50 hover:text-red-500"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {shareInfo.can_invite && (
                    <div>
                      <p className="text-xs font-semibold text-ink/55">멤버 초대</p>
                      <div className="mt-1.5 flex gap-2">
                        <select
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          data-testid="invite-select"
                          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                        >
                          <option value="">멤버 선택…</option>
                          {directory.map((u) => (
                            <option key={u.id} value={u.email}>
                              {u.name ? `${u.name} (${u.email})` : u.email}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => void invite()}
                          disabled={shareBusy || !inviteEmail}
                          data-testid="invite-button"
                          className="btn-dark shrink-0 !px-4 !py-2 text-xs disabled:opacity-50"
                        >
                          {shareBusy ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
                          초대
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                        초대된 멤버는 이 원고를 보고 편집(잠금 모델)할 수 있습니다.
                        승인된 멤버만 목록에 나타나며, 관리자는 모든 원고를 볼 수 있습니다.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end border-t border-black/5 px-6 py-3.5">
              <button
                onClick={() => setShareOpen(false)}
                className="btn rounded-full border border-black/10 px-5 !py-1.5 text-sm text-ink/60 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 외부 API 액세스 모달 ── */}
      {apiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-lightbox-fade">
          <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setApiOpen(false)} />
          <div
            data-testid="api-modal"
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-lightbox-zoom"
          >
            <div className="border-b border-black/5 px-6 py-4">
              <h2 className="font-display text-base font-bold text-ink">외부 API 액세스</h2>
              <p className="mt-0.5 text-xs text-ink/45">
                Claude Code 같은 외부 도구가 이 논문을 직접 읽고 수정할 수 있습니다
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* 프로젝트 주소 */}
              <div>
                <p className="text-xs font-semibold text-ink/55">이 프로젝트의 API 주소</p>
                <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-2.5 font-mono text-xs text-ink/80">
                  <span data-testid="api-url" className="min-w-0 flex-1 truncate">{`${API_BASE}/api/papers/${paper.key || id}`}</span>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${API_BASE}/api/papers/${paper.key || id}`);
                      flash("주소를 복사했습니다.");
                    }}
                    aria-label="API 주소 복사"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>

              {/* 토큰 */}
              <div>
                <p className="text-xs font-semibold text-ink/55">개인 API 토큰</p>
                {issuedToken ? (
                  <div className="mt-1.5 rounded-xl border border-accent/25 bg-accent/5 p-4">
                    <div className="flex items-center gap-3 font-mono text-xs text-ink">
                      <span data-testid="issued-token" className="min-w-0 flex-1 break-all">{issuedToken}</span>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(issuedToken);
                          setTokenCopied(true);
                          setTimeout(() => setTokenCopied(false), 1500);
                        }}
                        data-testid="copy-token"
                        className="btn shrink-0 rounded-full border border-accent/30 bg-white !px-3.5 !py-1.5 font-sans text-xs font-semibold text-accent hover:bg-accent/10"
                      >
                        {tokenCopied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                        {tokenCopied ? "복사됨" : "복사"}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-amber-600">
                      발급과 동시에 클립보드에 복사되었습니다. 토큰 원문은 서버에 저장되지 않아
                      이 창을 닫으면 다시 볼 수 없습니다 — 안전한 곳에 보관하세요.
                    </p>
                  </div>
                ) : tokenStatus?.has_token ? (
                  <p className="mt-1.5 text-xs text-ink/55">
                    {`발급된 토큰이 있습니다 (${tokenStatus.prefix}…). 원문은 서버에 저장되지 않아 다시 볼 수 없습니다 — 잊었다면 재발급하세요.`}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-ink/55">아직 발급된 토큰이 없습니다.</p>
                )}
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => void issueToken()}
                    disabled={apiBusy}
                    data-testid="issue-token"
                    className="btn-dark !px-4 !py-1.5 text-xs disabled:opacity-50"
                  >
                    <KeyRound size={12} /> {tokenStatus?.has_token ? "재발급" : "토큰 발급"}
                  </button>
                  {tokenStatus?.has_token && (
                    <button
                      onClick={() => void revokeToken()}
                      className="btn rounded-full border border-red-200 !px-4 !py-1.5 text-xs text-red-500 hover:bg-red-50"
                    >
                      폐기
                    </button>
                  )}
                </div>
              </div>

              {/* AI 에이전트 연동 — URL+토큰만 주면 자동 */}
              <div>
                <p className="text-xs font-semibold text-ink/55">AI 에이전트 연동</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink/45">
                  아래를 Claude Code · OpenAI Codex CLI · Gemini CLI 등에 붙여넣으면 됩니다.
                  에이전트가 API 응답에 담긴 안내를 따라 사용법을 스스로 파악해 작업합니다 —
                  별도 설명이 필요 없습니다. (브라우저형 ChatGPT 는 로컬 서버에 접근할 수
                  없으니 CLI 형 에이전트를 쓰세요.)
                </p>
                <div className="mt-1.5 flex items-start gap-2 rounded-xl bg-gray-50 p-4">
                  <pre data-testid="agent-prompt" className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink/75">
{`이 Quillo 논문을 작업해줘.
- API: ${API_BASE}/api/papers/${paper.key || id}
- 토큰: ${issuedToken ?? "<발급받은 토큰>"}`}
                  </pre>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        `이 Quillo 논문을 작업해줘.\n- API: ${API_BASE}/api/papers/${paper.key || id}\n- 토큰: ${issuedToken ?? "<발급받은 토큰>"}`,
                      );
                      flash("프롬프트를 복사했습니다.");
                    }}
                    aria-label="에이전트 프롬프트 복사"
                    data-testid="copy-agent-prompt"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                  외부 수정도 같은 잠금 모델을 따르므로, 누군가 편집 중이면 쓰기가 거절됩니다(423).
                  사용법 전문을 직접 보려면{" "}
                  <span className="font-mono text-ink/55">{`${API_BASE}/api/papers/${paper.key || id}/guide`}</span>
                  {" "}(Bearer 토큰 필요).
                </p>
              </div>
            </div>

            <div className="flex justify-end border-t border-black/5 px-6 py-3.5">
              <button
                onClick={() => setApiOpen(false)}
                className="btn rounded-full border border-black/10 px-5 !py-1.5 text-sm text-ink/60 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 본문: 트리 + 에디터 (+미리보기) ── */}
      <div ref={splitRef} className="flex min-h-0 flex-1">
        {/* 파일 트리 사이드바 */}
        <aside
          data-testid="paper-tree"
          onDragOver={(e) => {
            if (editable) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!editable) return;
            e.preventDefault();
            setDragging(false);
            setDropTarget(null);
            const fid = e.dataTransfer.getData("application/x-quillo-file");
            if (fid) void moveEntry(Number(fid), ""); // 빈 영역에 놓으면 최상위로
            else if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
          }}
          className={`relative flex w-64 shrink-0 flex-col border-r border-black/10 bg-ink transition ${
            dragging ? "ring-2 ring-inset ring-accent-cyan" : ""
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Files</span>
            {editable && (
              <div className="flex gap-1">
                {/* 호버 즉시 뜨는 커스텀 툴팁 — 느린 네이티브 title 대신 */}
                {(
                  [
                    { label: "새 파일", hint: "경로를 쓰면 폴더도 함께 생성", Icon: FilePlus, act: () => { setCreating("text"); setNewPath(""); } },
                    { label: "새 폴더", hint: "예: figures", Icon: FolderPlus, act: () => { setCreating("folder"); setNewPath(""); } },
                    { label: "이미지 업로드", hint: "드래그&드롭도 가능", Icon: UploadCloud, act: () => uploadRef.current?.click() },
                  ] as const
                ).map(({ label, hint, Icon, act }) => (
                  <button
                    key={label}
                    onClick={act}
                    aria-label={label}
                    className="group/tip relative grid h-6 w-6 place-items-center rounded text-white/45 transition hover:bg-white/10 hover:text-white"
                  >
                    <Icon size={13} />
                    <span
                      data-testid="sidebar-tooltip"
                      className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-max max-w-44 origin-top-left scale-95 rounded-lg bg-white px-2.5 py-1.5 text-left opacity-0 shadow-xl ring-1 ring-black/10 transition duration-100 group-hover/tip:scale-100 group-hover/tip:opacity-100"
                    >
                      <span className="block text-[11px] font-semibold text-ink">{label}</span>
                      <span className="block text-[10px] text-ink/45">{hint}</span>
                    </span>
                  </button>
                ))}
                <input
                  ref={uploadRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </div>

          {creating && (
            <form onSubmit={createEntry} className="px-3 pb-2">
              <input
                autoFocus
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onBlur={() => setCreating(null)}
                placeholder={creating === "text" ? "sections/intro.tex" : "figures"}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/25 focus:border-accent-cyan/60"
              />
            </form>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {tree.map((n) => renderNode(n, 0))}
          </div>

          {editable && (
            <p className="border-t border-white/10 px-4 py-2.5 text-[10px] leading-relaxed text-white/30">
              이미지를 이 영역에 끌어다 놓으면 업로드됩니다
            </p>
          )}
        </aside>

        {/* 에디터 / 미리보기 */}
        <main className="relative flex min-w-0 flex-1 flex-col bg-white">
          {viewRev ? (
            <div data-testid="diff-view" className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-black/5 bg-gray-50/80 px-5 py-2.5">
                <History size={14} className="text-accent" />
                <span className="font-mono text-xs font-semibold text-ink">{viewRev.path}</span>
                <span className="text-xs text-ink/45">
                  {`${viewRev.author_name} · ${revTime(viewRev.created_at)} 버전`}
                </span>
                <span className="text-[11px] text-ink/35">초록 줄이 추가, 빨간 줄이 삭제된 부분입니다</span>
                <div className="ml-auto flex items-center gap-2">
                  {editable && (
                    <button
                      onClick={() => void restoreRevision(viewRev)}
                      data-testid="restore-revision"
                      className="btn rounded-full border border-accent/30 bg-accent/5 !px-3.5 !py-1 text-xs font-semibold text-accent hover:bg-accent/10"
                    >
                      이 버전으로 되돌리기
                    </button>
                  )}
                  <button
                    onClick={() => setViewRev(null)}
                    className="btn rounded-full border border-black/10 !px-3.5 !py-1 text-xs text-ink/60 hover:bg-white"
                  >
                    에디터로 돌아가기
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5 font-mono text-[12.5px] leading-relaxed">
                {viewRev.diff.map((d, i) => (
                  <div
                    key={i}
                    data-testid={d.op === "+" ? "diff-add" : d.op === "-" ? "diff-del" : "diff-ctx"}
                    className={`whitespace-pre-wrap break-words rounded-sm px-2 ${
                      d.op === "+"
                        ? "bg-emerald-50 text-emerald-800"
                        : d.op === "-"
                          ? "bg-rose-50 text-rose-600 line-through decoration-rose-300"
                          : "text-ink/65"
                    }`}
                  >
                    <span className="mr-2 inline-block w-3 select-none text-ink/30">{d.op.trim() || " "}</span>
                    {d.text || " "}
                  </div>
                ))}
              </div>
            </div>
          ) : active == null ? (
            <div className="grid flex-1 place-items-center text-sm text-ink/35">
              왼쪽에서 파일을 선택하세요
            </div>
          ) : active.kind === "image" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={active.storage} alt={active.path} className="max-h-[55vh] max-w-full rounded-xl shadow-card ring-1 ring-black/5" />
              <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-2.5 font-mono text-xs text-ink/70">
                {`\\includegraphics[width=\\linewidth]{${active.path}}`}
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      `\\includegraphics[width=\\linewidth]{${active.path}}`,
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  aria-label="삽입 코드 복사"
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-xs text-ink/40">위 코드를 .tex 파일에 붙여넣으면 이 그림이 삽입됩니다</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-black/5 px-5 py-2">
                <span className="font-mono text-xs text-ink/50">{active.path}</span>
                {editable && (
                  <span className={`text-[11px] font-medium ${dirty ? "text-accent" : "text-ink/35"}`}>
                    {dirty ? "● 수정됨" : "저장됨"}
                  </span>
                )}
              </div>
              {editable && <LatexToolbar onInsert={insertSnippet} />}
              {editable ? (
                <LatexEditor
                  value={content}
                  onChange={(next) => {
                    setContent(next);
                    setDirty(true);
                  }}
                  textareaRef={textareaRef}
                  marks={commentMarks}
                  onSelectionChange={(s, e) => setSelRange(e > s ? { start: s, end: e } : null)}
                />
              ) : (
                <pre
                  ref={preRef}
                  onMouseUp={readSelection}
                  className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-[13px] leading-relaxed text-ink/75"
                >
                  {content ? <LatexHighlight value={content} /> : "빈 파일입니다."}
                </pre>
              )}
              {/* 선택 영역 → 코멘트 추가 (읽기 전용에서도 가능 — 리뷰 시나리오) */}
              {selRange && active?.kind === "text" && (
                <button
                  onClick={startComment}
                  data-testid="add-comment"
                  className="btn absolute right-4 top-24 z-10 rounded-full bg-ink !px-4 !py-2 text-xs font-semibold text-white shadow-xl hover:bg-ink/90"
                >
                  <MessageSquare size={13} /> 선택 구간에 코멘트
                </button>
              )}
            </>
          )}
        </main>

        {/* 버전 히스토리 패널 */}
        {historyOpen && (
          <aside
            data-testid="history-panel"
            className="flex w-80 shrink-0 flex-col border-l border-black/5 bg-white"
          >
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-ink/70">버전 히스토리</p>
                <p className="mt-0.5 text-[10px] text-ink/40">컴파일할 때마다 변경된 파일이 기록됩니다</p>
              </div>
              <button
                onClick={() => {
                  setHistoryOpen(false);
                  setViewRev(null);
                }}
                aria-label="히스토리 패널 닫기"
                className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 hover:bg-gray-100"
              >
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              {historyList === null ? (
                <div className="py-10 text-center">
                  <Loader2 size={18} className="mx-auto animate-spin text-accent" />
                </div>
              ) : historyList.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs leading-relaxed text-ink/40">
                  아직 기록이 없습니다. 컴파일하면 그 시점의 변경이 저장됩니다.
                </p>
              ) : (
                historyList.map((rev) => (
                  <button
                    key={rev.id}
                    onClick={() => void openRevision(rev)}
                    data-testid="history-row"
                    className={`block w-full rounded-xl border p-3 text-left transition hover:border-accent/30 ${
                      viewRev?.id === rev.id ? "border-accent/40 bg-accent/5" : "border-black/5"
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-ink">{rev.author_name}</span>
                      <span className="text-[10px] text-ink/40">{revTime(rev.created_at)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] text-ink/55">{rev.path}</span>
                      <span className="ml-auto flex shrink-0 gap-1">
                        {rev.first ? (
                          <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink/45">
                            처음
                          </span>
                        ) : (
                          <>
                            {rev.added > 0 && (
                              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
                                +{rev.added}
                              </span>
                            )}
                            {rev.removed > 0 && (
                              <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-500">
                                −{rev.removed}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}

        {/* 리뷰 코멘트 패널 */}
        {commentsOpen && (
          <aside
            data-testid="comments-panel"
            className="flex w-80 shrink-0 flex-col border-l border-black/5 bg-white"
          >
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-ink/70">리뷰 코멘트</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-ink/40">{active?.path ?? ""}</p>
              </div>
              <button
                onClick={() => setCommentsOpen(false)}
                aria-label="코멘트 패널 닫기"
                className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 hover:bg-gray-100"
              >
                <X size={14} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
              {/* 새 코멘트 작성 */}
              {draft && (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-3.5">
                  <p className="line-clamp-2 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-ink/60 ring-1 ring-black/5">
                    {draft.quote}
                  </p>
                  <textarea
                    autoFocus
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="코멘트를 입력하세요"
                    data-testid="comment-input"
                    rows={3}
                    className="mt-2 w-full resize-none rounded-lg border border-black/10 px-2.5 py-2 text-xs outline-none focus:border-accent"
                  />
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      onClick={() => setDraft(null)}
                      className="btn rounded-full border border-black/10 !px-3 !py-1 text-[11px] text-ink/55"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => void submitComment()}
                      disabled={!draftBody.trim()}
                      data-testid="submit-comment"
                      className="btn-dark !px-3.5 !py-1 text-[11px] disabled:opacity-50"
                    >
                      등록
                    </button>
                  </div>
                </div>
              )}

              {fileComments.length === 0 && !draft && (
                <p className="px-2 py-8 text-center text-xs leading-relaxed text-ink/40">
                  본문에서 구간을 선택하면 코멘트를 달 수 있습니다.
                  편집 잠금이 없어도 (리뷰 중에도) 가능합니다.
                </p>
              )}

              {[...fileComments]
                .sort((a, b) => (a.status === b.status ? b.id - a.id : a.status === "open" ? -1 : 1))
                .map((c) => {
                  const anchored = locateQuote(c) >= 0;
                  const canDelete = me != null && (me.id === c.author_id || paper.mine || me.role === "admin");
                  return (
                    <div
                      key={c.id}
                      data-testid="comment-row"
                      className={`rounded-xl border p-3.5 transition ${
                        c.status === "resolved"
                          ? "border-black/5 bg-gray-50 opacity-60"
                          : "border-black/5 bg-white shadow-sm"
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-ink">{c.author_name}</span>
                        <span className="text-[10px] text-ink/35">{c.created_at.slice(0, 10)}</span>
                        {c.status === "resolved" && (
                          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                            해결됨
                          </span>
                        )}
                      </div>
                      {c.quote && (
                        <button
                          onClick={() => jumpToComment(c)}
                          disabled={!anchored || !editable}
                          title={anchored ? "본문에서 위치 보기" : "원문이 변경되어 위치를 찾을 수 없습니다"}
                          className="mt-1.5 block w-full truncate rounded-lg bg-amber-50 px-2.5 py-1.5 text-left font-mono text-[11px] text-amber-800/80 ring-1 ring-amber-100 disabled:cursor-default"
                        >
                          {anchored ? c.quote : `(원문 변경됨) ${c.quote}`}
                        </button>
                      )}
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink/75">{c.body}</p>
                      <div className="mt-2.5 flex gap-1.5">
                        <button
                          onClick={() => void toggleResolve(c)}
                          data-testid="resolve-comment"
                          className="btn rounded-full border border-black/10 !px-2.5 !py-0.5 text-[10px] text-ink/55 hover:bg-gray-50"
                        >
                          <Check size={11} /> {c.status === "open" ? "해결" : "다시 열기"}
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => void deleteComment(c)}
                            aria-label="코멘트 삭제"
                            className="btn rounded-full border border-black/10 !px-2.5 !py-0.5 text-[10px] text-ink/45 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={11} /> 삭제
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </aside>
        )}

        {/* 드래그 분할바 */}
        <div
          data-testid="split-divider"
          onPointerDown={startSplitDrag}
          className="group relative z-10 -mx-0.5 w-1.5 shrink-0 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10 transition group-hover:w-1 group-hover:bg-accent/50" />
        </div>

        {/* PDF 미리보기 패널 — 상시 표시 */}
        <section
          data-testid="preview-panel"
          style={{ width: `${previewPct}%` }}
          className="flex shrink-0 flex-col bg-gray-100"
        >
            <div className="flex items-center justify-between border-b border-black/5 bg-white px-4 py-2">
              <span data-testid="preview-entry" className="text-xs font-semibold text-ink/55">
                {preview?.error
                  ? "컴파일 오류"
                  : compiledEntry !== "main.tex"
                    ? `PDF 미리보기 · ${compiledEntry}`
                    : "PDF 미리보기"}
              </span>
              <div className="flex items-center gap-1">
                {preview?.url && (
                  <>
                    <button
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = preview.url!;
                        a.download = `${(paper?.title ?? "paper").replace(/\s+/g, "_")}.pdf`;
                        a.click();
                      }}
                      aria-label="PDF 다운로드"
                      title="PDF 다운로드"
                      className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      onClick={() => window.open(preview.url, "_blank")}
                      aria-label="인쇄"
                      title="새 탭에서 열기 (인쇄)"
                      className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                    >
                      <Printer size={13} />
                    </button>
                    <span className="mx-1 h-4 w-px bg-black/10" />
                  </>
                )}
                <button
                  onClick={() => void compile()}
                  disabled={compiling}
                  aria-label="다시 컴파일"
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent disabled:opacity-50"
                >
                  <RefreshCw size={13} className={compiling ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
            {preview?.error ? (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-white p-5 font-mono text-xs leading-relaxed text-red-600">
                {preview.error}
              </pre>
            ) : preview?.bytes ? (
              <div data-testid="pdf-preview" className="flex min-h-0 flex-1 flex-col">
                <PdfViewer data={preview.bytes} />
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 place-items-center bg-gray-200/70 text-sm text-ink/40">
                {compiling ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-accent" /> 컴파일 중…
                  </span>
                ) : (
                  "컴파일하면 미리보기가 표시됩니다"
                )}
              </div>
            )}
          </section>
      </div>
    </div>
  );
}
