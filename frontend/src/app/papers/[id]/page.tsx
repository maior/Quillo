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
  key: string; // hash key for external exposure
  mine: boolean; // I am the owner
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
  columns: number; // 1=single column, 2=two column
  description: string;
}

// Layout badge — distinguishes the column layout at a glance in the list
function layoutBadge(t: Template) {
  if (t.kind === "presentation")
    return { label: `Slides`, cls: "bg-amber-50 text-amber-600" };
  if (t.columns === 2) return { label: `2-col`, cls: "bg-accent/10 text-accent" };
  return { label: `1-col`, cls: "bg-ink/5 text-ink/50" };
}

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "revision", label: "Revision" },
  { value: "published", label: "Published" },
];

// ── Tree construction ──
type TreeNode = {
  name: string;
  path: string;
  file?: PFile; // folder row or file
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

  // ── Review comments ──
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

  // Current position of a comment range — search for the quote near the anchor (may not be found if the body changed)
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
      flash(e instanceof Error ? e.message : "Failed to post the comment.");
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
    if (!confirm("Delete this comment?")) return;
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

  // Select → comment even in read-only view (reviewers leave comments only, without a lock)
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
  const [previewPct, setPreviewPct] = useState(46); // preview width (%) adjusted by the split bar
  const splitRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Template modal ──
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
    if (!confirm("main.tex will be replaced with this template skeleton. Proceed?")) return;
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
      flash("Template applied.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to apply the template.");
    } finally {
      setTplBusy(false);
    }
  };

  // ── Share / edit invitation modal ──
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
      flash("Invitation sent.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to send the invitation.");
    } finally {
      setShareBusy(false);
    }
  };

  const removeCollaborator = async (c: Collaborator) => {
    if (!confirm(`Revoke edit access for ${c.name}?`)) return;
    await authFetch(`/api/papers/${id}/collaborators/${c.user_id}`, { method: "DELETE" });
    await loadShare();
  };

  // ── Version history ──
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
    setPreviewPct((p) => Math.min(p, 34)); // when the panel opens, the preview yields width — prevents crushing the editor
    void loadHistory();
  };

  const openRevision = async (rev: RevMeta) => {
    setViewRev(await authFetch<RevDetail>(`/api/papers/${id}/history/${rev.id}`));
  };

  const restoreRevision = async (rev: RevDetail) => {
    if (!confirm(`Revert ${rev.path} to the ${revTime(rev.created_at)} version?`)) return;
    try {
      const r = await authFetch<{ file_id: number }>(
        `/api/papers/${id}/history/${rev.id}/restore`,
        { method: "POST" },
      );
      setViewRev(null);
      const fs = await loadAll();
      const f = fs.find((x) => x.id === r.file_id);
      if (f) await openFile(f);
      flash("Reverted to that version.");
      void compile();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to revert.");
    }
  };

  // ── External API access modal (integration with external tools like Claude Code) ──
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
    if (tokenStatus?.has_token && !confirm("The existing token will be invalidated immediately. Reissue?")) return;
    setApiBusy(true);
    try {
      const r = await authFetch<{ token: string }>("/api/auth/token", { method: "POST" });
      setIssuedToken(r.token);
      setTokenStatus(await authFetch<{ has_token: boolean; prefix?: string }>("/api/auth/token"));
      // Copy to clipboard immediately on issue so it isn't lost when closing
      try {
        await navigator.clipboard.writeText(r.token);
        flash("Token copied to the clipboard.");
      } catch {
        /* if clipboard permission is denied, use the copy button */
      }
    } finally {
      setApiBusy(false);
    }
  };

  const revokeToken = async () => {
    if (!confirm("Revoking the token immediately blocks external tools from access. Revoke?")) return;
    await authFetch("/api/auth/token", { method: "DELETE" });
    setIssuedToken(null);
    setTokenStatus({ has_token: false });
  };

  // Toolbar insertion — wrap the selection if there is one, otherwise place the cursor at the placeholder
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
        // select the placeholder (or empty span) — typing right away overwrites it
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
        // The preview is an always-on panel — auto-compile once on open so it shows immediately
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
      flash(e instanceof Error ? e.message : "Failed to acquire the lock.");
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
        if (!quiet) flash("Saved.");
      } catch (e) {
        flash(e instanceof Error ? e.message : "Failed to save.");
      }
    },
    [active, content, id],
  );

  // Auto-release the lock on leaving the screen — so someone who left doesn't block other members for the 30-minute TTL.
  // Keep the lock through tab switches; release only when actually leaving the editor (route change / tab close).
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
      editableRef.current = false; // prevent duplicate release
      const base = `${API_BASE}/api/papers/${id}`;
      const f = activeRef.current;
      // if the last input was before the auto-save (2.5s), save right before leaving
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
    window.addEventListener("pagehide", releaseLock); // tab close / refresh
    return () => {
      window.removeEventListener("pagehide", releaseLock);
      releaseLock(); // navigation to another screen within the SPA (unmount)
    };
  }, [id]);

  // Auto-save — silently saves 2.5 seconds after typing stops (no save button)
  useEffect(() => {
    if (!editable || !dirty) return;
    const t = setTimeout(() => void saveFile(true), 2500);
    return () => clearTimeout(t);
  }, [content, editable, dirty, saveFile]);

  // ⌘S/Ctrl+S = compile (saving is automatic, so the shortcut refreshes the typeset output)
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
      flash(release ? "Saved and ended editing." : "Saved.");
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
      flash(err instanceof Error ? err.message : "Failed to create.");
    }
  };

  // Drag-move within the tree — a file/folder into a folder (or the top level)
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder path, "" = top level

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
      flash(`Moved '${base}' to ${folder || "the top level"}.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to move.");
    }
  };

  const removeEntry = async (f: PFile) => {
    if (!confirm(`Delete '${f.path}'?${f.kind === "folder" ? " Files inside the folder will also be deleted." : ""}`)) return;
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
        flash(d.detail ?? `Failed to upload ${file.name}`);
      }
    }
    await loadAll();
  };

  const [compiledEntry, setCompiledEntry] = useState("main.tex");

  const compile = async () => {
    setCompiling(true);
    try {
      // Compile = save + typeset: apply the body and metadata (title/status/journal) first
      if (editable) {
        if (dirty) await saveFile(true);
        await authFetch(`/api/papers/${id}`, { method: "PUT", json: meta });
      }
      // Preview based on the active file — for a section file, borrow main's preamble and typeset just that file
      const entry = active?.kind === "text" ? active.path : "main.tex";
      const res = await fetch(
        `${API_BASE}/api/papers/${id}/compile?entry=${encodeURIComponent(entry)}`,
        { method: "POST", credentials: "include" },
      );
      setCompiledEntry(entry);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPreview({ error: d.detail ?? "Failed to compile." });
        return;
      }
      const bytes = await res.arrayBuffer();
      if (preview?.url) URL.revokeObjectURL(preview.url);
      // url is for download/print, bytes is for pdf.js rendering
      setPreview({
        url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
        bytes,
      });
    } finally {
      setCompiling(false);
      if (historyOpen) void loadHistory(); // compile = checkpoint — refresh the open panel
    }
  };

  // Split-bar drag — adjusts the preview width within a 25–70% range
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

  // Current ranges of open comments — highlight via the mark layer (excluded if not found due to body changes)
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
                  // dropping an OS file onto a folder uploads it into that folder
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
              aria-label={`Delete ${node.path}`}
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
      {/* ── Top bar — Overleaf-style dark header ── */}
      <div
        data-testid="editor-topbar"
        className="relative z-20 flex flex-wrap items-center gap-2.5 border-b border-white/10 bg-ink px-4 py-2.5"
      >
        <Link
          href="/papers"
          title="Back to my manuscripts"
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
              placeholder="Target journal"
              className="w-40 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent-cyan/60"
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {notice && <span className="mr-1 text-xs font-medium text-accent-cyan">{notice}</span>}
          <button
            onClick={() => void compile()}
            disabled={compiling}
            title="Save + typeset (⌘S)"
            className="btn rounded-full bg-accent !px-4 !py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)] hover:bg-accent/90 disabled:opacity-60"
          >
            {compiling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Compile
          </button>
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <button
            onClick={exportZip}
            title="Download project ZIP"
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
            title="Version history (recorded on every compile)"
            data-testid="toggle-history"
            className={`btn rounded-full border !px-3.5 !py-1.5 text-xs ${
              historyOpen
                ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                : "border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <History size={13} /> History
          </button>
          <button
            onClick={() => {
              setHistoryOpen(false);
              setCommentsOpen((v) => {
                if (!v) setPreviewPct((p) => Math.min(p, 34));
                return !v;
              });
            }}
            title="Review comments"
            data-testid="toggle-comments"
            className={`btn rounded-full border !px-3.5 !py-1.5 text-xs ${
              commentsOpen
                ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                : "border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <MessageSquare size={13} /> Comments
            {openCount > 0 && (
              <span className="rounded-full bg-accent-cyan/20 px-1.5 text-[10px] font-bold text-accent-cyan">
                {openCount}
              </span>
            )}
          </button>
          <button
            onClick={() => void openShare()}
            title="Invite members / share"
            className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Users size={13} /> Share
          </button>
          <button
            onClick={() => void openApi()}
            title="External API / token"
            className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            <KeyRound size={13} /> API
          </button>
          {editable ? (
            <>
              <button
                onClick={() => void openTemplates()}
                title="Journal / conference templates"
                className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LayoutTemplate size={13} /> Templates
              </button>
              <button
                onClick={() => void saveMetaAndUnlock(true)}
                disabled={busy}
                className="btn rounded-full border border-white/15 !px-3.5 !py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LockOpen size={13} /> End editing
              </button>
            </>
          ) : paper.locked ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3.5 py-1.5 text-xs font-semibold text-amber-300">
              <Lock size={12} /> {paper.lock_user_name} is editing
            </span>
          ) : (
            <button
              onClick={startEdit}
              className="btn rounded-full bg-white !px-4 !py-1.5 text-xs font-semibold text-ink hover:bg-white/90"
            >
              <Lock size={13} /> Start editing
            </button>
          )}

          {/* User menu */}
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              data-testid="user-menu"
              aria-label="User menu"
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
                    <p className="truncate text-sm font-semibold text-ink">{me?.name || "Member"}</p>
                    <p className="truncate text-xs text-ink/45">{me?.email}</p>
                  </div>
                  <div className="py-1.5">
                    <Link
                      href="/papers"
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                    >
                      <FileText size={14} className="text-ink/35" /> My manuscripts
                    </Link>
                    <Link
                      href="/lounge"
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                    >
                      <Users size={14} className="text-ink/35" /> Member lounge
                    </Link>
                    {me?.role === "admin" && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                      >
                        <Lock size={14} className="text-ink/35" /> Admin console
                      </Link>
                    )}
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void openApi();
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-ink/70 transition hover:bg-gray-50 hover:text-ink"
                    >
                      <KeyRound size={14} className="text-ink/35" /> Settings · API token
                    </button>
                  </div>
                  <div className="border-t border-black/5 py-1.5">
                    <button
                      onClick={async () => {
                        // Release the lock before the session disappears (a later unmount release would be a no-op due to 401)
                        if (editable) {
                          editableRef.current = false;
                          await authFetch(`/api/papers/${id}/unlock`, { method: "POST" }).catch(() => {});
                        }
                        await authApi.logout();
                        router.replace("/login");
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-red-500 transition hover:bg-red-50"
                    >
                      <ArrowLeft size={14} /> Log out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Template selection modal ── */}
      {tplOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-lightbox-fade">
          <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setTplOpen(false)} />
          <div
            data-testid="template-modal"
            className="relative flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-lightbox-zoom"
          >
            {/* Left: template list */}
            <div className="flex w-80 shrink-0 flex-col border-r border-black/5">
              <div className="border-b border-black/5 px-5 py-4">
                <h2 className="font-display text-base font-bold text-ink">Journal / conference templates</h2>
                <p className="mt-0.5 text-xs text-ink/45">{`${tplList.length} templates · compiles cleanly the moment you apply`}</p>
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
                  Apply this template
                </button>
                <button
                  onClick={() => setTplOpen(false)}
                  className="btn rounded-full border border-black/10 px-5 text-sm text-ink/60 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
            {/* Right: typeset preview */}
            <div className="flex min-w-0 flex-1 flex-col bg-gray-200/70">
              <div className="border-b border-black/5 bg-white px-4 py-2 text-xs font-semibold text-ink/55">
                Typeset preview
              </div>
              {tplPreview ? (
                <div data-testid="template-preview" className="flex min-h-0 flex-1 flex-col">
                  <PdfViewer data={tplPreview} />
                </div>
              ) : (
                <div className="grid flex-1 place-items-center text-sm text-ink/40">
                  {tplBusy ? <Loader2 size={18} className="animate-spin text-accent" /> : "Select a template"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Share / edit invitation modal ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-lightbox-fade">
          <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setShareOpen(false)} />
          <div
            data-testid="share-modal"
            className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-lightbox-zoom"
          >
            <div className="border-b border-black/5 px-6 py-4">
              <h2 className="font-display text-base font-bold text-ink">Share · invite to edit</h2>
              <p className="mt-0.5 text-xs text-ink/45">
                Only the owner and invited members can view this manuscript
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {shareInfo && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-ink/55">Owner</p>
                    <p className="mt-1.5 text-sm font-medium text-ink">{shareInfo.owner.name}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-ink/55">
                      {`Invited members (${shareInfo.collaborators.length})`}
                    </p>
                    {shareInfo.collaborators.length === 0 ? (
                      <p className="mt-1.5 text-xs text-ink/45">
                        No members invited yet. Invite collaborators below.
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
                                aria-label={`Remove ${c.name} from invitees`}
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
                      <p className="text-xs font-semibold text-ink/55">Invite a member</p>
                      <div className="mt-1.5 flex gap-2">
                        <select
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          data-testid="invite-select"
                          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                        >
                          <option value="">Select a member…</option>
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
                          Invite
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                        Invited members can view and edit this manuscript (lock model).
                        Only approved members appear in the list, and admins can view every manuscript.
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
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── External API access modal ── */}
      {apiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-lightbox-fade">
          <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setApiOpen(false)} />
          <div
            data-testid="api-modal"
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-lightbox-zoom"
          >
            <div className="border-b border-black/5 px-6 py-4">
              <h2 className="font-display text-base font-bold text-ink">External API access</h2>
              <p className="mt-0.5 text-xs text-ink/45">
                External tools like Claude Code can read and edit this paper directly
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* Project address */}
              <div>
                <p className="text-xs font-semibold text-ink/55">API address for this project</p>
                <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-2.5 font-mono text-xs text-ink/80">
                  <span data-testid="api-url" className="min-w-0 flex-1 truncate">{`${API_BASE}/api/papers/${paper.key || id}`}</span>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${API_BASE}/api/papers/${paper.key || id}`);
                      flash("Address copied.");
                    }}
                    aria-label="Copy API address"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>

              {/* Token */}
              <div>
                <p className="text-xs font-semibold text-ink/55">Personal API token</p>
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
                        {tokenCopied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-amber-600">
                      Copied to the clipboard on issue. The raw token is not stored on the server,
                      so you cannot see it again once you close this window — keep it somewhere safe.
                    </p>
                  </div>
                ) : tokenStatus?.has_token ? (
                  <p className="mt-1.5 text-xs text-ink/55">
                    {`A token has been issued (${tokenStatus.prefix}…). The raw value is not stored on the server, so you cannot view it again — reissue it if you've forgotten it.`}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-ink/55">No token issued yet.</p>
                )}
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => void issueToken()}
                    disabled={apiBusy}
                    data-testid="issue-token"
                    className="btn-dark !px-4 !py-1.5 text-xs disabled:opacity-50"
                  >
                    <KeyRound size={12} /> {tokenStatus?.has_token ? "Reissue" : "Issue token"}
                  </button>
                  {tokenStatus?.has_token && (
                    <button
                      onClick={() => void revokeToken()}
                      className="btn rounded-full border border-red-200 !px-4 !py-1.5 text-xs text-red-500 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              {/* AI agent integration — just provide the URL + token and it's automatic */}
              <div>
                <p className="text-xs font-semibold text-ink/55">AI agent integration</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink/45">
                  Paste the snippet below into Claude Code, OpenAI Codex CLI, Gemini CLI, and the like.
                  The agent follows the guidance in the API response to figure out how to use it on its own —
                  no extra explanation needed. (Browser-based ChatGPT cannot reach a local server,
                  so use a CLI-based agent.)
                </p>
                <div className="mt-1.5 flex items-start gap-2 rounded-xl bg-gray-50 p-4">
                  <pre data-testid="agent-prompt" className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink/75">
{`Please work on this Quillo paper.
- API: ${API_BASE}/api/papers/${paper.key || id}
- Token: ${issuedToken ?? "<your issued token>"}`}
                  </pre>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        `Please work on this Quillo paper.\n- API: ${API_BASE}/api/papers/${paper.key || id}\n- Token: ${issuedToken ?? "<your issued token>"}`,
                      );
                      flash("Prompt copied.");
                    }}
                    aria-label="Copy agent prompt"
                    data-testid="copy-agent-prompt"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                  External edits follow the same lock model, so writes are rejected while someone is editing (423).
                  To read the full usage guide directly, see{" "}
                  <span className="font-mono text-ink/55">{`${API_BASE}/api/papers/${paper.key || id}/guide`}</span>
                  {" "}(Bearer token required).
                </p>
              </div>
            </div>

            <div className="flex justify-end border-t border-black/5 px-6 py-3.5">
              <button
                onClick={() => setApiOpen(false)}
                className="btn rounded-full border border-black/10 px-5 !py-1.5 text-sm text-ink/60 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main: tree + editor (+ preview) ── */}
      <div ref={splitRef} className="flex min-h-0 flex-1">
        {/* File tree sidebar */}
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
            if (fid) void moveEntry(Number(fid), ""); // dropping on empty space moves to the top level
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
                {/* Custom tooltip that appears instantly on hover — instead of the slow native title */}
                {(
                  [
                    { label: "New file", hint: "Include a path to create folders too", Icon: FilePlus, act: () => { setCreating("text"); setNewPath(""); } },
                    { label: "New folder", hint: "e.g. figures", Icon: FolderPlus, act: () => { setCreating("folder"); setNewPath(""); } },
                    { label: "Upload image", hint: "Drag & drop also works", Icon: UploadCloud, act: () => uploadRef.current?.click() },
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
              Drag images into this area to upload them
            </p>
          )}
        </aside>

        {/* Editor / preview */}
        <main className="relative flex min-w-0 flex-1 flex-col bg-white">
          {viewRev ? (
            <div data-testid="diff-view" className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-black/5 bg-gray-50/80 px-5 py-2.5">
                <History size={14} className="text-accent" />
                <span className="font-mono text-xs font-semibold text-ink">{viewRev.path}</span>
                <span className="text-xs text-ink/45">
                  {`${viewRev.author_name} · ${revTime(viewRev.created_at)} version`}
                </span>
                <span className="text-[11px] text-ink/35">Green lines were added, red lines were removed</span>
                <div className="ml-auto flex items-center gap-2">
                  {editable && (
                    <button
                      onClick={() => void restoreRevision(viewRev)}
                      data-testid="restore-revision"
                      className="btn rounded-full border border-accent/30 bg-accent/5 !px-3.5 !py-1 text-xs font-semibold text-accent hover:bg-accent/10"
                    >
                      Revert to this version
                    </button>
                  )}
                  <button
                    onClick={() => setViewRev(null)}
                    className="btn rounded-full border border-black/10 !px-3.5 !py-1 text-xs text-ink/60 hover:bg-white"
                  >
                    Back to editor
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
              Select a file on the left
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
                  aria-label="Copy insert code"
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-xs text-ink/40">Paste the code above into a .tex file to insert this image</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-black/5 px-5 py-2">
                <span className="font-mono text-xs text-ink/50">{active.path}</span>
                {editable && (
                  <span className={`text-[11px] font-medium ${dirty ? "text-accent" : "text-ink/35"}`}>
                    {dirty ? "● Modified" : "Saved"}
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
                  {content ? <LatexHighlight value={content} /> : "This file is empty."}
                </pre>
              )}
              {/* Selection → add comment (also works in read-only — review scenario) */}
              {selRange && active?.kind === "text" && (
                <button
                  onClick={startComment}
                  data-testid="add-comment"
                  className="btn absolute right-4 top-24 z-10 rounded-full bg-ink !px-4 !py-2 text-xs font-semibold text-white shadow-xl hover:bg-ink/90"
                >
                  <MessageSquare size={13} /> Comment on selection
                </button>
              )}
            </>
          )}
        </main>

        {/* Version history panel */}
        {historyOpen && (
          <aside
            data-testid="history-panel"
            className="flex w-80 shrink-0 flex-col border-l border-black/5 bg-white"
          >
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-ink/70">Version history</p>
                <p className="mt-0.5 text-[10px] text-ink/40">Changed files are recorded on every compile</p>
              </div>
              <button
                onClick={() => {
                  setHistoryOpen(false);
                  setViewRev(null);
                }}
                aria-label="Close history panel"
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
                  No records yet. Compiling saves the changes at that point.
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
                            First
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

        {/* Review comments panel */}
        {commentsOpen && (
          <aside
            data-testid="comments-panel"
            className="flex w-80 shrink-0 flex-col border-l border-black/5 bg-white"
          >
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-ink/70">Review comments</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-ink/40">{active?.path ?? ""}</p>
              </div>
              <button
                onClick={() => setCommentsOpen(false)}
                aria-label="Close comments panel"
                className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 hover:bg-gray-100"
              >
                <X size={14} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
              {/* Compose a new comment */}
              {draft && (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-3.5">
                  <p className="line-clamp-2 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-ink/60 ring-1 ring-black/5">
                    {draft.quote}
                  </p>
                  <textarea
                    autoFocus
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="Enter a comment"
                    data-testid="comment-input"
                    rows={3}
                    className="mt-2 w-full resize-none rounded-lg border border-black/10 px-2.5 py-2 text-xs outline-none focus:border-accent"
                  />
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      onClick={() => setDraft(null)}
                      className="btn rounded-full border border-black/10 !px-3 !py-1 text-[11px] text-ink/55"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void submitComment()}
                      disabled={!draftBody.trim()}
                      data-testid="submit-comment"
                      className="btn-dark !px-3.5 !py-1 text-[11px] disabled:opacity-50"
                    >
                      Post
                    </button>
                  </div>
                </div>
              )}

              {fileComments.length === 0 && !draft && (
                <p className="px-2 py-8 text-center text-xs leading-relaxed text-ink/40">
                  Select a range in the body to leave a comment.
                  This works even without an edit lock (during review too).
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
                            Resolved
                          </span>
                        )}
                      </div>
                      {c.quote && (
                        <button
                          onClick={() => jumpToComment(c)}
                          disabled={!anchored || !editable}
                          title={anchored ? "View location in the body" : "The original text changed, so the location can't be found"}
                          className="mt-1.5 block w-full truncate rounded-lg bg-amber-50 px-2.5 py-1.5 text-left font-mono text-[11px] text-amber-800/80 ring-1 ring-amber-100 disabled:cursor-default"
                        >
                          {anchored ? c.quote : `(original text changed) ${c.quote}`}
                        </button>
                      )}
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink/75">{c.body}</p>
                      <div className="mt-2.5 flex gap-1.5">
                        <button
                          onClick={() => void toggleResolve(c)}
                          data-testid="resolve-comment"
                          className="btn rounded-full border border-black/10 !px-2.5 !py-0.5 text-[10px] text-ink/55 hover:bg-gray-50"
                        >
                          <Check size={11} /> {c.status === "open" ? "Resolve" : "Reopen"}
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => void deleteComment(c)}
                            aria-label="Delete comment"
                            className="btn rounded-full border border-black/10 !px-2.5 !py-0.5 text-[10px] text-ink/45 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </aside>
        )}

        {/* Draggable split bar */}
        <div
          data-testid="split-divider"
          onPointerDown={startSplitDrag}
          className="group relative z-10 -mx-0.5 w-1.5 shrink-0 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10 transition group-hover:w-1 group-hover:bg-accent/50" />
        </div>

        {/* PDF preview panel — always visible */}
        <section
          data-testid="preview-panel"
          style={{ width: `${previewPct}%` }}
          className="flex shrink-0 flex-col bg-gray-100"
        >
            <div className="flex items-center justify-between border-b border-black/5 bg-white px-4 py-2">
              <span data-testid="preview-entry" className="text-xs font-semibold text-ink/55">
                {preview?.error
                  ? "Compile error"
                  : compiledEntry !== "main.tex"
                    ? `PDF preview · ${compiledEntry}`
                    : "PDF preview"}
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
                      aria-label="Download PDF"
                      title="Download PDF"
                      className="grid h-7 w-7 place-items-center rounded-lg text-ink/40 transition hover:bg-accent/10 hover:text-accent"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      onClick={() => window.open(preview.url, "_blank")}
                      aria-label="Print"
                      title="Open in a new tab (print)"
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
                  aria-label="Recompile"
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
                    <Loader2 size={16} className="animate-spin text-accent" /> Compiling…
                  </span>
                ) : (
                  "Compile to show the preview"
                )}
              </div>
            )}
          </section>
      </div>
    </div>
  );
}
