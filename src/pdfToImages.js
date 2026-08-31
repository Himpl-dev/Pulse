import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Renders a PDF's pages to JPEG images entirely in the browser (the same
// engine Firefox/Chrome use to display PDFs) — this is what keeps PDF
// support off the serverless function's 30s clock, unlike the earlier
// attempt where Claude read the raw PDF server-side. Each page becomes a
// plain image, which flows through the same fast path already proven to
// work for photos/drawings.
export async function pdfToImages(file, { maxPages = 5, scale = 1.5, quality = 0.82 } = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const baseName = file.name.replace(/\.pdf$/i, '');
  const images = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    images.push({ blob, name: pageCount > 1 ? `${baseName}-p${i}.jpg` : `${baseName}.jpg` });
  }

  return { images, totalPages: pdf.numPages, truncated: pdf.numPages > maxPages };
}
