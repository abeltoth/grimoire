/** A tool's input a line each, as `name: value`; what isn't text, as JSON. */
export function inputText(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input)
    .map(([name, value]) => `${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}
