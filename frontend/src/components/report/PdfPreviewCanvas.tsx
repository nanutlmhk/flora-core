import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfPreviewCanvasProps = {
  pdfData: Uint8Array;
};

export default function PdfPreviewCanvas({ pdfData }: PdfPreviewCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const [status, setStatus] = useState("Loading PDF…");
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateWidth = () => setHostWidth(Math.max(0, Math.floor(host.clientWidth)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || pdfData.byteLength === 0 || hostWidth <= 0) return;

    let cancelled = false;
    const loadingTask = getDocument({ data: pdfData.slice() });
    host.replaceChildren();

    const render = async () => {
      const pdf = await loadingTask.promise;
      if (cancelled) return;
      setStatus(`Rendering ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}…`);

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, Math.min(hostWidth - 24, 1050));
        const displayScale = Math.max(0.5, availableWidth / baseViewport.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: displayScale * pixelRatio });

        const pageShell = document.createElement("section");
        pageShell.className = "mx-auto overflow-hidden rounded-sm bg-white shadow-lg ring-1 ring-black/10";
        pageShell.setAttribute("aria-label", `PDF page ${pageNumber} of ${pdf.numPages}`);

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${Math.ceil(baseViewport.width * displayScale)}px`;
        canvas.style.height = `${Math.ceil(baseViewport.height * displayScale)}px`;
        canvas.style.maxWidth = "100%";
        canvas.style.display = "block";
        pageShell.appendChild(canvas);
        host.appendChild(pageShell);

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("PDF canvas is unavailable");
        await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
      }

      if (!cancelled) setStatus("");
    };

    render().catch((reason: unknown) => {
      if (cancelled) return;
      host.replaceChildren();
      setStatus("");
      setError(reason instanceof Error ? reason.message : "PDF preview could not be rendered");
    });

    return () => {
      cancelled = true;
      loadingTask.destroy().catch(() => undefined);
    };
  }, [hostWidth, pdfData]);

  return (
    <div className="relative h-full min-h-0 overflow-auto rounded-xl bg-slate-300 p-3 dark:bg-slate-950">
      {status ? <div className="sticky top-2 z-10 mx-auto mb-3 w-fit rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow">{status}</div> : null}
      {error ? (
        <div role="alert" className="mx-auto mt-8 max-w-xl rounded-2xl border border-red-400/60 bg-[var(--app-panel-bg)] p-5 text-center">
          <div className="font-bold text-red-600 dark:text-red-300">Preview could not be displayed</div>
          <div className="mt-1 text-sm text-[var(--app-muted)]">{error}</div>
          <div className="mt-3 text-xs text-[var(--app-muted)]">The PDF is still available through Save PDF or Open / Print.</div>
        </div>
      ) : null}
      <div ref={hostRef} className="mx-auto flex min-h-full w-full flex-col items-center gap-4" />
    </div>
  );
}
