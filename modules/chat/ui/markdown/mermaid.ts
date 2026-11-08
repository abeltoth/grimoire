// Loaded on first use, so Mermaid stays out of the first bundle.
import mermaid from 'mermaid';
import type { DiagramLook } from './diagrams';

let drawn = 0;

/**
 * Draws a diagram as SVG in the book's look. Strict: no scripts, clicks
 * or HTML in labels, only SVG text. Gives the SVG and the id its own ids
 * start with. Throws when the source can't be read.
 */
export async function draw(code: string, look: DiagramLook): Promise<{ svg: string; id: string }> {
  const { ink, page, node, line, accent } = look;
  const variables: Record<string, string | boolean | undefined> = {
    darkMode: look.dark,
    fontFamily: look.font,
    fontSize: look.size,
    // Drawn flat in ink, as the page's other figures are.
    dropShadow: 'none',
    background: page,
    textColor: ink,
    titleColor: ink,
    lineColor: line,
    primaryColor: node,
    primaryTextColor: ink,
    primaryBorderColor: line,
    secondaryColor: node,
    secondaryTextColor: ink,
    secondaryBorderColor: line,
    tertiaryColor: page,
    tertiaryTextColor: ink,
    tertiaryBorderColor: line,
    clusterBkg: page,
    clusterBorder: line,
    edgeLabelBackground: page,
    noteBkgColor: page,
    noteTextColor: ink,
    noteBorderColor: accent,
    actorBkg: node,
    actorBorder: line,
    actorTextColor: ink,
    actorLineColor: line,
    signalColor: ink,
    signalTextColor: ink,
    labelTextColor: ink,
    loopTextColor: ink,
    activationBorderColor: accent,
  };
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    suppressErrorRendering: true,
    theme: 'base',
    // A colour the theme doesn't set keeps Mermaid's own.
    themeVariables: Object.fromEntries(
      Object.entries(variables).filter((entry) => entry[1] !== undefined),
    ),
  });
  const id = `gr-diagram-${++drawn}`;
  return { svg: (await mermaid.render(id, code)).svg, id };
}
