/** Bounded display parser; the original file is always downloaded unchanged. */
export function csvPreview(content: string, maxRows = 201, maxColumns = 50): { rows: string[][]; truncated: boolean; error?: string } {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, truncated = false;
  const field = () => { if (row.length < maxColumns) row.push(value); else truncated = true; value = ''; };
  const line = () => { field(); rows.push(row); row = []; };
  content = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || !value) quoted = !quoted;
      else value += c;
    } else if (c === ',' && !quoted) field();
    else if ((c === '\n' || c === '\r') && !quoted) {
      line(); if (c === '\r' && content[i + 1] === '\n') i++;
      if (rows.length >= maxRows) return { rows, truncated: truncated || i < content.length - 1 };
    } else value += c;
  }
  if (quoted) return { rows: [], truncated: false, error: 'Unclosed quoted field. Use Text to inspect the original CSV.' };
  if (value || row.length) line();
  return { rows, truncated };
}
