"use client";

// Reference helper — add an entry to a .bib file without typing it.
// The server fetches BibTeX from doi.org (only the DOI is sent; no manuscript content).
import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { authFetch } from "@/lib/api";

/** If the key already exists, append a, b, c… */
export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (const c of "abcdefghijklmnopqrstuvwxyz") if (!taken.has(base + c)) return base + c;
  return `${base}${Date.now() % 1000}`;
}

/** Reflow the one-line BibTeX from doi.org into one field per line; rename the key if it clashes. */
export function tidyBibtex(raw: string, taken: Set<string>): { key: string; bibtex: string } {
  const m = /^@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*)\}\s*$/.exec(raw.trim());
  if (!m) return { key: "", bibtex: raw.trim() };
  const key = uniqueKey(m[2].replace(/[^A-Za-z0-9:_-]/g, ""), taken);
  const body = m[3].trim().replace(/,\s*(?=[A-Za-z]+\s*=\s*[{"])/g, ",\n  ");
  return { key, bibtex: `@${m[1].toLowerCase()}{${key},\n  ${body}\n}` };
}

export default function BibHelper({ existingKeys, onAdd, onClose }: { existingKeys: string[]; onAdd: (bibtex: string, key: string) => void; onClose: () => void }) {
  const [doi, setDoi] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [found, setFound] = useState<{ key: string; bibtex: string } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const taken = useMemo(() => new Set([...existingKeys, ...added]), [existingKeys, added]);

  const lookup = async () => {
    setBusy(true);
    setErr("");
    setFound(null);
    try {
      const r = await authFetch<{ bibtex: string }>(`/api/papers/bibtex/doi?doi=${encodeURIComponent(doi.trim())}`);
      setFound(tidyBibtex(r.bibtex, taken));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not fetch the reference.");
    } finally {
      setBusy(false);
    }
  };
  const add = (bibtex: string, key: string) => {
    onAdd(bibtex, key);
    setAdded((a) => [...a, key]);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div data-testid="bib-helper" role="dialog" aria-label="Add reference" className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3">
          <h2 className="font-display text-base font-bold text-ink">Add reference by DOI</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-ink/40 hover:bg-black/5">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1016/j.matchar.2024.114289 or a doi.org URL" aria-label="DOI" className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 font-mono text-xs outline-none focus:border-accent" />
            <button type="submit" disabled={busy || !doi.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {busy && <Loader2 size={13} className="animate-spin" />} Fetch
            </button>
          </form>
          <p className="text-[11px] leading-relaxed text-ink/45">The server sends only the DOI to doi.org to fetch the citation. No manuscript content is sent.</p>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
          {found && (
            <div className="space-y-2">
              <pre data-testid="bib-preview" className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-mono text-[11.5px] leading-relaxed text-ink/80">{found.bibtex}</pre>
              <button type="button" disabled={added.includes(found.key)} onClick={() => add(found.bibtex, found.key)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
                <Plus size={13} /> {added.includes(found.key) ? "Added" : `Add to .bib (\\cite{${found.key}})`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
