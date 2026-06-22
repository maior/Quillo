"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * pdf.js-based preview — instead of the browser's built-in viewer (dark background and toolbar),
 * it renders the pages (canvases) directly on a light background.
 *
 * Note: the ResizeObserver watches the "outer scroll container" rather than the content,
 * and re-renders only when the width actually changes — otherwise a height change from
 * adding a canvas would re-trigger itself, causing an infinite loop (flicker).
 */
export default function PdfViewer({ data }: { data: ArrayBuffer }) {
  const scrollRef = useRef<HTMLDivElement>(null); // width observation target (determined by layout)
  const contentRef = useRef<HTMLDivElement>(null); // content that holds the canvases
  const [rendering, setRendering] = useState(true);
  const renderSeq = useRef(0);
  const lastWidth = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (!scroll || !content) return;
      const seq = ++renderSeq.current;
      setRendering(true);

      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      // data is reused, so pass a copy (pdf.js detaches the buffer)
      const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
      if (cancelled || seq !== renderSeq.current) return;

      const pageWidth = scroll.clientWidth - 48; // left/right margin
      lastWidth.current = scroll.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      const canvases: HTMLCanvasElement[] = [];

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        if (cancelled || seq !== renderSeq.current) return;
        const base = page.getViewport({ scale: 1 });
        const scale = pageWidth / base.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.className =
          "mx-auto mb-5 block rounded-sm bg-white shadow-[0_2px_14px_rgba(16,24,40,.12)] ring-1 ring-black/5";

        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (cancelled || seq !== renderSeq.current) return;
        canvases.push(canvas);
      }
      // swap in all pages at once after rendering completes — no blank screen in between
      content.replaceChildren(...canvases);
      setRendering(false);
    };

    void render();

    // react only to "width" changes such as dragging the split bar (height change = added content → ignore)
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (Math.abs(width - lastWidth.current) < 2) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => void render(), 250);
    });
    if (scrollRef.current) observer.observe(scrollRef.current);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      observer.disconnect();
    };
  }, [data]);

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-gray-200/70 p-6">
      {rendering && (
        <div className="absolute inset-x-0 top-10 z-10 flex justify-center">
          <Loader2 size={20} className="animate-spin text-accent" />
        </div>
      )}
      <div ref={contentRef} />
    </div>
  );
}
