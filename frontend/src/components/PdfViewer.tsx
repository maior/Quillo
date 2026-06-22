"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * pdf.js 기반 미리보기 — 브라우저 내장 뷰어(어두운 배경·툴바) 대신
 * 밝은 배경 위에 종이(캔버스)를 직접 렌더한다.
 *
 * 주의: ResizeObserver 는 내용물이 아닌 "외부 스크롤 컨테이너"를 관찰하고
 * 폭이 실제로 변했을 때만 재렌더한다 — 캔버스 추가로 높이가 변하면
 * 자기 자신을 다시 트리거하는 무한 루프(깜박임)가 생기기 때문.
 */
export default function PdfViewer({ data }: { data: ArrayBuffer }) {
  const scrollRef = useRef<HTMLDivElement>(null); // 폭 관찰 대상 (레이아웃이 결정)
  const contentRef = useRef<HTMLDivElement>(null); // 캔버스가 들어가는 내용물
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

      // data 는 재사용되므로 복사본 전달 (pdf.js 가 buffer 를 detach 함)
      const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
      if (cancelled || seq !== renderSeq.current) return;

      const pageWidth = scroll.clientWidth - 48; // 좌우 여백
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
      // 전 페이지 렌더 완료 후 한 번에 교체 — 중간 빈 화면 없음
      content.replaceChildren(...canvases);
      setRendering(false);
    };

    void render();

    // 분할바 드래그 등 "폭" 변화에만 반응 (높이 변화 = 내용물 추가 → 무시)
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
