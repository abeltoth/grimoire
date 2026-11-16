/** A place in a file a reply points to: its path, as written, and the line, when one is named. */
export interface FilePlace {
  path: string;
  line?: number;
}

/** A link's address that names a scheme, such as https: or mailto:; a drive letter or a line isn't one. */
const SCHEME = /^[a-z][a-z0-9+.-]+:(?!\d+(?:-\d+)?$)/i;
/** A line at the end of a path: `#L42`, `#L42-L50`, `:42` or `:42-50`. */
const LINE = /(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?:-\d+)?)$/;
/** A path in code: words joined by slashes, ending in a name with an extension, and maybe a line. */
const PATH_IN_CODE =
  /^(?:[A-Za-z]:)?[\\/]?(?:[\w.@~-]+[\\/])*[\w.@-]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/;

/** The file a link points to, or undefined for one that leaves the app, such as a web page. */
export function fileOfLink(href: string): FilePlace | undefined {
  let address = href.trim();
  if (/^file:/i.test(address)) address = address.replace(/^file:\/*(?=[A-Za-z]:)|^file:\/\//i, '');
  else if (SCHEME.test(address) || address.startsWith('#') || !address) return undefined;
  try {
    address = decodeURI(address);
  } catch {
    // Written with a stray %, it stays as it is.
  }
  return placeOf(address);
}

/** The file code points to, such as `src/app.ts:42`; a bare name like `package.json` isn't taken for one. */
export function fileOfCode(code: string): FilePlace | undefined {
  const text = code.trim();
  if (!PATH_IN_CODE.test(text) || !(/[\\/]/.test(text) || LINE.test(text))) return undefined;
  return placeOf(text);
}

function placeOf(address: string): FilePlace | undefined {
  const line = LINE.exec(address);
  const path = line ? address.slice(0, line.index) : address;
  if (!path) return undefined;
  const number = Number(line?.[1] ?? line?.[2]);
  return number > 0 ? { path, line: number } : { path };
}
