export interface DiffLine { kind: 'add' | 'remove' | 'context'; text: string; old: number; line: number }

export function lineCount(content: string): number {
  if (typeof content !== 'string' || content.length === 0) return 0;
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

export function hasHunks(patch?: string): boolean {
  return typeof patch === 'string' && /^@@ /m.test(patch);
}

export function diffLines(patch = ''): DiffLine[] {
  let old = 0, line = 0;
  const result: DiffLine[] = [];
  const normalized = patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const text of normalized.split('\n')) {
    if (text.startsWith('\\')) continue; // "\ No newline at end of file"
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { old = Number(hunk[1]); line = Number(hunk[2]); continue; }
    if (!old && !line) continue;
    if (text.startsWith('+')) result.push({ kind: 'add', text: text.slice(1), old, line: line++ });
    else if (text.startsWith('-')) result.push({ kind: 'remove', text: text.slice(1), old: old++, line });
    else if (text.startsWith(' ')) result.push({ kind: 'context', text: text.slice(1), old: old++, line: line++ });
  }
  return result;
}

export function previousLine(patch: string, target: number): number | 'introduced' {
  let offset = 0;
  for (const row of diffLines(patch)) {
    if (row.kind !== 'remove' && row.line === target) return row.kind === 'add' ? 'introduced' : row.old;
    if (row.line > target) break;
    if (row.kind === 'add') offset--;
    if (row.kind === 'remove') offset++;
  }
  return target + offset;
}
