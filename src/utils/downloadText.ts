/** Start a browser download; its eventual save location or completion is not observable here. */
export function downloadText(filename: string, type: string, text: string): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  let url: string | undefined;
  try {
    url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    // Safari can cancel a download if its URL is released in the click's task.
    if (url) {
      const createdUrl = url;
      setTimeout(() => URL.revokeObjectURL(createdUrl), 0);
    }
  }
}
