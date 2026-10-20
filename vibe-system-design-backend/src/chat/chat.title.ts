/**
 * Cut a title out of the first user message of a session.
 *
 * The title never exceeds the limit. A long word is cut instead of the title
 * becoming empty.
 */
export function cutTitle(text: string, limit = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace <= 0) return slice.trim();
  return slice.slice(0, lastSpace).trim();
}
