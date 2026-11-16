/** A file's path as the Files page names it: from the folder, or in full, from your home folder when it's in it. */
export function shownPath(path: string, home: string): string {
  if (!/^([a-zA-Z]:)?\//.test(path)) return path;
  const top = home.replaceAll('\\', '/').replace(/\/$/, '');
  return top && path.toLowerCase().startsWith(`${top.toLowerCase()}/`)
    ? `~${path.slice(top.length)}`
    : path;
}

/** The folder a file is in, with a slash; empty at the top. */
export function folderOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash + 1);
}

export function nameOf(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}
