import React, { useEffect, useState } from 'react';
import { Wrench, Paperclip, X, Loader2 } from 'lucide-react';
import { TOKENS } from '../theme';
import { supabase } from '../supabaseClient';
import { AdvisorChat } from './AdvisorChat';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit
const MAX_PDF_BYTES = 20 * 1024 * 1024; // raw PDF, before conversion
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const BUCKET = 'eng_drawings';

// Renders a signed-URL thumbnail for one of a message's attached
// drawings/photos (including PDF pages, already converted to images before
// upload) — the bucket is private, so there's no public URL to just point
// an <img> at.
function AttachmentThumb({ path, name }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [path]);

  if (!url) {
    return <p className="text-xs italic mb-1" style={{ color: TOKENS.textFaint }}>📎 {name || 'attachment'}</p>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-block mb-1.5 mr-1.5">
      <img src={url} alt={name || 'attachment'} style={{ maxWidth: 140, maxHeight: 110, borderRadius: 8, display: 'block' }} />
    </a>
  );
}

// A message's attachments live in the new `attachments` array column, or —
// for messages sent before multi-attachment support existed — the older
// single attachment_path/attachment_name columns.
function messageAttachments(m) {
  if (m.attachments?.length) return m.attachments;
  if (m.attachment_path) return [{ path: m.attachment_path, name: m.attachment_name }];
  return [];
}

// Troubleshooting advisor chat with drawing/photo/PDF upload. Images upload
// straight from the browser to Supabase Storage (RLS-scoped to the caller's
// own folder); a PDF is rendered to page images in the browser first (see
// pdfToImages.js) — either way, api/engineer-advisor.js only ever handles
// storage paths, never raw file bytes over the API body, and never has to
// do slow PDF processing itself.
export function EngineerPanel({ accessToken, userId }) {
  const [pendingFiles, setPendingFiles] = useState([]); // [{ blob, name }]
  const [converting, setConverting] = useState(false);
  const [fileError, setFileError] = useState('');

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setFileError('');

    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Only JPEG/PNG/WEBP/GIF images or a PDF are supported.');
      return;
    }

    if (file.type === 'application/pdf') {
      if (file.size > MAX_PDF_BYTES) {
        setFileError('PDF is too large — 20MB max.');
        return;
      }
      setConverting(true);
      try {
        // pdfjs-dist is a large library (~130KB gzipped) — load it only when
        // someone actually attaches a PDF, not on every page load.
        const { pdfToImages } = await import('../pdfToImages');
        const { images, truncated, totalPages } = await pdfToImages(file);
        setPendingFiles(images);
        if (truncated) setFileError(`Converted the first 5 of ${totalPages} pages.`);
      } catch (err) {
        console.error('Failed to convert PDF', err);
        setFileError('Failed to read that PDF — try a different file.');
      } finally {
        setConverting(false);
      }
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setFileError('Image is too large — 5MB max.');
      return;
    }
    setPendingFiles([{ blob: file, name: file.name }]);
  }

  async function buildRequestBody(prompt) {
    if (pendingFiles.length === 0) return { prompt };
    const uploaded = await Promise.all(pendingFiles.map(async ({ blob, name }) => {
      const path = `${userId}/${crypto.randomUUID()}-${name}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob);
      if (error) throw new Error('Failed to upload an attachment — try again.');
      return { path, name };
    }));
    setPendingFiles([]);
    return { prompt, attachments: uploaded };
  }

  return (
    <AdvisorChat
      table="eng_messages"
      endpoint="/api/engineer-advisor"
      accessToken={accessToken}
      icon={Wrench}
      iconColor={TOKENS.blue}
      title="Engineer / Technician Advisor"
      description="Private to you — talk through a fault, attach a drawing, photo, or PDF if it helps, and when to escalate."
      emptyHint="Describe the fault or attach a drawing/photo/PDF, and talk through diagnosis, next steps, and when to escalate."
      buildRequestBody={buildRequestBody}
      renderAttachment={(m) => {
        const files = messageAttachments(m);
        return files.length > 0 && (
          <div className="flex flex-wrap">
            {files.map((f, i) => <AttachmentThumb key={i} path={f.path} name={f.name} />)}
          </div>
        );
      }}
      formAccessory={
        <div className="flex items-center gap-1 flex-shrink-0">
          {fileError && <span className="text-xs" style={{ color: TOKENS.coral }}>{fileError}</span>}
          <input
            id="eng-attach-input"
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            onChange={pickFile}
            disabled={converting}
            className="hidden"
          />
          <label
            htmlFor="eng-attach-input"
            className="p-2 rounded-lg cursor-pointer"
            style={{ background: pendingFiles.length ? TOKENS.blue : TOKENS.surface2, color: pendingFiles.length ? '#0B0D11' : TOKENS.textMuted }}
            title={pendingFiles.length ? `${pendingFiles.length} page${pendingFiles.length > 1 ? 's' : ''} ready` : 'Attach a drawing, photo, or PDF'}
          >
            {converting ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          </label>
          {pendingFiles.length > 0 && (
            <button type="button" onClick={() => setPendingFiles([])} className="p-1" style={{ color: TOKENS.textFaint }} aria-label="Remove attachment">
              <X size={14} />
            </button>
          )}
        </div>
      }
    />
  );
}
