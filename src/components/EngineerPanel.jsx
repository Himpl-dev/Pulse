import React, { useEffect, useState } from 'react';
import { Wrench, Paperclip, X, FileText } from 'lucide-react';
import { TOKENS } from '../theme';
import { supabase } from '../supabaseClient';
import { AdvisorChat } from './AdvisorChat';

// Claude's per-image limit is 5MB; PDFs are allowed up to 32MB.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const BUCKET = 'eng_drawings';

function isPdf(name) {
  return (name || '').toLowerCase().endsWith('.pdf');
}

// Renders a signed-URL thumbnail for a message's attached drawing/photo/PDF
// — the bucket is private, so there's no public URL to just point an <img>
// at. PDFs can't render as an <img>, so those get a plain "open" link.
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
  if (isPdf(name)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 mb-1.5 text-xs underline" style={{ color: TOKENS.text }}>
        <FileText size={13} /> {name || 'attachment.pdf'}
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block mb-1.5">
      <img src={url} alt={name || 'attachment'} style={{ maxWidth: 220, maxHeight: 160, borderRadius: 8, display: 'block' }} />
    </a>
  );
}

// Troubleshooting advisor chat with drawing/photo upload. Uploads go
// straight from the browser to Supabase Storage (RLS-scoped to the caller's
// own folder), so api/engineer-advisor.js only ever handles a path, not raw
// file bytes over the API body.
export function EngineerPanel({ accessToken, userId }) {
  const [pendingFile, setPendingFile] = useState(null);
  const [fileError, setFileError] = useState('');

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setFileError('');
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Only JPEG/PNG/WEBP/GIF images or a PDF are supported.');
      return;
    }
    const maxBytes = isPdf(file.name) ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      setFileError(isPdf(file.name) ? 'PDF is too large — 20MB max.' : 'Image is too large — 5MB max.');
      return;
    }
    setPendingFile(file);
  }

  async function buildRequestBody(prompt) {
    if (!pendingFile) return { prompt };
    const path = `${userId}/${crypto.randomUUID()}-${pendingFile.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, pendingFile);
    if (error) throw new Error('Failed to upload the attachment — try again.');
    const name = pendingFile.name;
    setPendingFile(null);
    return { prompt, attachmentPath: path, attachmentName: name };
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
      renderAttachment={(m) => m.attachment_path && <AttachmentThumb path={m.attachment_path} name={m.attachment_name} />}
      formAccessory={
        <div className="flex items-center gap-1 flex-shrink-0">
          {fileError && <span className="text-xs" style={{ color: TOKENS.coral }}>{fileError}</span>}
          <input
            id="eng-attach-input"
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            onChange={pickFile}
            className="hidden"
          />
          <label
            htmlFor="eng-attach-input"
            className="p-2 rounded-lg cursor-pointer"
            style={{ background: pendingFile ? TOKENS.blue : TOKENS.surface2, color: pendingFile ? '#0B0D11' : TOKENS.textMuted }}
            title={pendingFile ? pendingFile.name : 'Attach a drawing, photo, or PDF'}
          >
            <Paperclip size={16} />
          </label>
          {pendingFile && (
            <button type="button" onClick={() => setPendingFile(null)} className="p-1" style={{ color: TOKENS.textFaint }} aria-label="Remove attachment">
              <X size={14} />
            </button>
          )}
        </div>
      }
    />
  );
}
