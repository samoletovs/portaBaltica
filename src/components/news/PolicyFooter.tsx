/**
 * Points at the file this page was rendered from.
 *
 * The policy commits to publishing our methods; saying which file in the public
 * repository produced the page a reader is looking at is the cheapest possible
 * way to make that checkable rather than asserted.
 */
export function PolicyFooter({ sourcePath }: { sourcePath: string }) {
  return (
    <p className="mt-12 border-t border-slate-800/60 pt-4 text-xs leading-relaxed text-slate-500">
      This page is rendered from{' '}
      <a
        href={`https://github.com/samoletovs/portaBaltica/blob/master/${sourcePath}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono underline underline-offset-2 hover:text-slate-300"
      >
        {sourcePath}
      </a>{' '}
      in the public repository. Its revision history is the record of what we have
      promised and when.
    </p>
  );
}
