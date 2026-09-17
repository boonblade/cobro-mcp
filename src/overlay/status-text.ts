export function stripStatusLabel(text: string, labels: readonly string[]): string {
  const trimmed = text.trim();
  for (const label of labels) {
    const re = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*', 'i');
    if (re.test(trimmed)) return trimmed.replace(re, '');
  }
  return trimmed;
}
