import React, { useEffect, useRef, useState } from 'react';
import { ScanLine, Loader2, RotateCcw } from 'lucide-react';
import { TOKENS, hexToRgba } from '../theme';
import { CopyButton } from './AiOutput';

// Live camera barcode/QR scanner. Deliberately not using the browser-native
// BarcodeDetector API — it's Chrome/Edge only, and this is explicitly meant
// for phone use, where a large share of users are on Safari/iOS (no
// BarcodeDetector support at all). @zxing/browser is pure JS, works
// everywhere getUserMedia does, and decodes both 1D barcodes (EAN, Code128,
// UPC, etc.) and 2D codes (QR, Data Matrix, PDF417...) — dynamically
// imported so the library only loads once someone opens this tab.
export function ScannerPanel() {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const foundRef = useRef(false); // guards against a burst of detections firing setResult repeatedly
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null); // { text, format }
  const [error, setError] = useState('');

  // codeReader.reset() alone doesn't reliably release the camera hardware —
  // the browser's camera-in-use indicator can stay lit even once the app's
  // own UI looks stopped. Stopping the video element's MediaStream tracks
  // directly is the one guaranteed way to actually turn the camera off.
  // Wrapped defensively: zxing may still have an in-flight scan frame
  // mid-callback when this runs, and touching the video/stream out from
  // under it shouldn't be allowed to throw past this function — deliberately
  // NOT nulling srcObject here, since that's what was hitting the library's
  // own scan loop mid-draw. Stopping the tracks is what actually releases
  // the camera; leaving a dead stream referenced briefly is harmless.
  function releaseCamera() {
    try {
      readerRef.current?.reset();
    } catch (err) {
      console.error('Failed to reset code reader', err);
    }
    readerRef.current = null;
    try {
      videoRef.current?.srcObject?.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.error('Failed to stop camera tracks', err);
    }
  }

  useEffect(() => {
    // Release the camera if the user navigates away mid-scan.
    return () => releaseCamera();
  }, []);

  // Stopping the camera happens here, separately from detection — so a
  // detected code shows up the instant it's seen, with camera cleanup as an
  // independent follow-up rather than something that has to complete first.
  useEffect(() => {
    if (result) {
      releaseCamera();
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  async function startScan() {
    setError('');
    setResult(null);
    foundRef.current = false;
    setStarting(true);
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, NotFoundException }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const codeReader = new BrowserMultiFormatReader();
      readerRef.current = codeReader;
      setScanning(true);
      await codeReader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (res, err) => {
          if (res && !foundRef.current) {
            foundRef.current = true;
            try {
              setResult({ text: res.getText(), format: BarcodeFormat[res.getBarcodeFormat()] });
            } catch (readErr) {
              console.error('Failed to read decoded result', readErr);
              setError('Detected something but failed to read it — try again.');
            }
          } else if (err && !(err instanceof NotFoundException)) {
            // NotFoundException just means "no code in this frame yet" —
            // fires constantly while scanning, not a real error.
            console.error('Scan error', err);
          }
        }
      );
    } catch (err) {
      console.error('Failed to start scanner', err);
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera access was denied — allow camera permission for this site and try again.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : 'Failed to access the camera — try again.'
      );
      setScanning(false);
    } finally {
      setStarting(false);
    }
  }

  function stopScan() {
    releaseCamera();
    setScanning(false);
  }

  return (
    <div className="space-y-4 max-w-md">
      <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
        <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
          <ScanLine size={15} /> Scanner
        </h2>
        <p className="text-xs mb-3" style={{ color: TOKENS.textFaint }}>
          Point your camera at a barcode or QR code — works best on a phone, using the rear camera.
        </p>

        <div
          className="rounded-lg overflow-hidden mb-3 flex items-center justify-center"
          style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, aspectRatio: '4 / 3' }}
        >
          {/* Always mounted (zxing attaches to it directly) — just hidden until scanning starts. */}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={{ display: scanning ? 'block' : 'none' }}
            muted
            playsInline
          />
          {!scanning && (
            <ScanLine size={32} style={{ color: TOKENS.textFaint }} />
          )}
        </div>

        {error && <p className="text-xs mb-2" style={{ color: TOKENS.coral }}>{error}</p>}

        {scanning ? (
          <button
            onClick={stopScan}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={startScan}
            disabled={starting}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
            style={{ background: TOKENS.blue, color: '#0B0D11' }}
          >
            {starting ? <><Loader2 size={14} className="animate-spin" /> Starting…</> : result ? <><RotateCcw size={14} /> Scan again</> : 'Start scanning'}
          </button>
        )}
      </div>

      {result && (
        <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
          <div className="flex items-center justify-between mb-2 gap-2">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: hexToRgba(TOKENS.teal, 0.15), color: TOKENS.teal }}
            >
              {result.format}
            </span>
            <CopyButton text={result.text} label="Copy" />
          </div>
          <p className="text-sm break-all" style={{ color: TOKENS.text }}>{result.text}</p>
        </div>
      )}
    </div>
  );
}
