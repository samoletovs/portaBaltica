import { useEffect, useRef, useState } from 'react';
import { evidenceFileHash, evidenceFileUrl, verifyEvidenceDownloads } from '../../evidence-api';
import type { EvidenceFile, EvidenceManifest } from '../../evidence-types';
import { EvidenceDownloadLink } from './EvidenceDownloadLink';

const DOWNLOADS: { file: EvidenceFile; label: string; detail: string }[] = [
  { file: 'source.json', label: 'Download original source JSON', detail: 'Exact retrieved bytes, including any countries and periods outside the Baltic subset.' },
  { file: 'observations.csv', label: 'Download all observations CSV', detail: 'Every normalized Baltic observation, with missing values, flags and retrieval provenance.' },
  { file: 'normalized.json', label: 'Download normalized JSON', detail: 'All selected coordinates without rounding. Displayed rows were checked against this file’s checksum.' },
  { file: 'dictionary.json', label: 'Download data dictionary', detail: 'Column meanings, pinned measurement dimensions and source labels.' },
];

export function EvidenceDownloads({ manifest }: { manifest: EvidenceManifest }) {
  const [verification, setVerification] = useState<'idle' | 'checking' | 'verified' | 'failed'>('idle');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function verify() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setVerification('checking');
    try {
      await verifyEvidenceDownloads(manifest, request.signal);
      if (!request.signal.aborted) setVerification('verified');
    } catch {
      if (!request.signal.aborted) setVerification('failed');
    }
  }
  const files = manifest.artifacts['comparison.json'] ? [...DOWNLOADS, {
    file: 'comparison.json' as const, label: 'Download every comparison row', detail: 'All categorized changes against the previous capture, not just the visible preview.',
  }] : DOWNLOADS;
  return (
    <section className="evidence-section" aria-labelledby="downloads-heading">
      <h2 id="downloads-heading" className="site-section-title text-title font-semibold news-fg">Take the evidence with you</h2>
      <p className="text-ui news-muted">These are frozen files, not requests to the live Eurostat service. SHA-256 checks compare bytes with this manifest; they are not publisher signatures.</p>
      <ul className="evidence-downloads">
        {files.map(({ file, label, detail }) => <li key={file}>
          <EvidenceDownloadLink manifest={manifest} file={file} label={label} />
          <p className="text-ui news-muted">{detail}</p>
          <details>
            <summary className="text-ui news-muted">SHA-256 for {file}</summary>
            <code className="evidence-checksum text-ui">{evidenceFileHash(manifest, file)}</code>
          </details>
        </li>)}
      </ul>
      <div className="evidence-actions">
        <a className="site-action text-ui" href={evidenceFileUrl(manifest.snapshot_id, 'manifest.json')}>Open manifest JSON</a>
        <button type="button" className="site-action text-ui" disabled={verification === 'checking'} onClick={() => void verify()}>
          {verification === 'checking' ? 'Checking download checksums…' : 'Verify all downloads'}
        </button>
      </div>
      <p className="text-ui news-muted" role={verification === 'failed' ? 'alert' : 'status'}>
        {verification === 'verified' ? 'Source, CSV and dictionary bytes match their recorded SHA-256 checksums. Displayed JSON was verified when this page opened.'
          : verification === 'failed' ? 'Downloads could not all be verified. A file is unavailable or its bytes differ from the manifest. Do not rely on unchecked files; try verification again.'
            : verification === 'checking' ? 'Reading the source, CSV and dictionary to verify their exact bytes.'
              : 'The displayed normalized data is checksum-verified. Use “Verify all downloads” to check the original source, CSV and dictionary too.'}
      </p>
    </section>
  );
}
