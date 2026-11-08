/**
 * A CSS colour as #rrggbb or #rrggbbaa, for what draws with colours and
 * not CSS, such as the VS Code editor and Mermaid. It's read where it's
 * used, so var() and the theme resolve; undefined when it can't be read.
 */
export function hex(where: Element, value: string): string | undefined {
  if (!value) return undefined;
  const probe = document.createElement('span');
  probe.style.color = value;
  where.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const parts = /rgba?\(([^)]+)\)/
    .exec(computed)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts || parts.length < 3 || parts.some((part) => Number.isNaN(part))) return undefined;
  const [r, g, b, a = 1] = parts as [number, number, number, number?];
  const byte = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a * 255) : ''}`;
}
