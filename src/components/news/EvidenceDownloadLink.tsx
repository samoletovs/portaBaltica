import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { evidenceFileUrl, fetchEvidenceDownload } from '../../evidence-api';
import type { EvidenceFile, EvidenceManifest } from '../../evidence-types';

interface EvidenceDownloadLinkProps {
  manifest: EvidenceManifest;
  file: EvidenceFile;
  label: string;
}

export function EvidenceDownloadLink({ manifest, file, label }: EvidenceDownloadLinkProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function download(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (status === 'loading') return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus('loading');
    try {
      const body = await fetchEvidenceDownload(manifest, file, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([body], { type: file.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `portabaltica-${manifest.snapshot_id}-${file}`;
      try {
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setStatus('ready');
    } catch {
      if (!controller.signal.aborted) setStatus('error');
    }
  }
  return <>
    <a className="evidence-capture-link news-link text-callout" href={evidenceFileUrl(manifest.snapshot_id, file)}
      download={file} onClick={event => void download(event)} aria-disabled={status === 'loading'} aria-busy={status === 'loading'}>
      {label}
    </a>
    {status !== 'idle' && <p className="text-ui news-muted" role={status === 'error' ? 'alert' : 'status'}>
      {status === 'loading' ? 'Checking exact bytes before downloading…'
        : status === 'ready' ? 'Checksum matched. Download started.'
          : 'Download withheld: the file could not be retrieved, verified or saved. Try again in a current browser.'}
    </p>}
  </>;
}
