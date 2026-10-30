"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface PageSize {
  width: number;
  height: number;
}

interface Props {
  // URL of the PDF (fetched with the browser's cookies).
  src: string;
  width?: number;
  // Content positioned over each page; coordinates are fractions of the page.
  overlay?: (page: number, size: PageSize) => ReactNode;
  // Called with page (1-based) and the click position as fractions of the page.
  onPageClick?: (page: number, fx: number, fy: number) => void;
}

// Renders each page with pdf.js into a canvas, with an absolutely positioned overlay layer.
export function PdfPages({ src, width = 720, overlay, onPageClick }: Props) {
  const [pages, setPages] = useState<PageSize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const res = await fetch(src, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`could not load document (${res.status})`);
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) })
        .promise;
      const sizes: PageSize[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        sizes.push({ width, height: (base.height / base.width) * width });
      }
      if (cancelled) return;
      setPages(sizes);
      await new Promise((r) => requestAnimationFrame(r));
      for (let i = 1; i <= pdf.numPages; i++) {
        const canvas = canvases.current[i - 1];
        if (!canvas || cancelled) continue;
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
      }
    })().catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [src, width]);

  if (error) return <p role="alert">{error}</p>;
  if (pages.length === 0) return <p>Loading document…</p>;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {pages.map((size, i) => (
        <div
          key={i}
          data-page={i + 1}
          style={{
            position: "relative",
            width: size.width,
            height: size.height,
            boxShadow: "0 1px 4px #0003",
            background: "#fff",
          }}
          onClick={(e) => {
            if (!onPageClick || e.target !== e.currentTarget.querySelector("canvas")) return;
            const rect = e.currentTarget.getBoundingClientRect();
            onPageClick(
              i + 1,
              (e.clientX - rect.left) / rect.width,
              (e.clientY - rect.top) / rect.height,
            );
          }}
        >
          <canvas
            ref={(el) => void (canvases.current[i] = el)}
            style={{ width: size.width, height: size.height, display: "block" }}
          />
          {overlay?.(i + 1, size)}
        </div>
      ))}
    </div>
  );
}
