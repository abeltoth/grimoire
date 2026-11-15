import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { PictureAttachment } from '@grimoire/contract';
import { expand } from '../core/files';

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Bigger files aren't read for a preview, so one stray attachment can't stall the service. */
const MAX_PREVIEW_BYTES = 20_000_000;

/**
 * An attached file that is a picture, base64-encoded to show in the window,
 * whose page may only show pictures it's given; null for anything else.
 */
export function pictureAt(
  file: string,
  cwd?: string,
): Pick<PictureAttachment, 'mediaType' | 'data'> | null {
  const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) return null;
  const full = cwd ? path.resolve(expand(cwd), file) : file;
  try {
    if (statSync(full).size > MAX_PREVIEW_BYTES) return null;
    return { mediaType, data: readFileSync(full).toString('base64') };
  } catch {
    return null;
  }
}
