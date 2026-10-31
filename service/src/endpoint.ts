import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * The local socket the service listens on: a named pipe on Windows, a Unix
 * socket in the data directory elsewhere. One per data directory, so the
 * dev and installed apps each get their own service.
 */
export function endpointFor(dataDir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const id = createHash('sha256').update(dataDir.toLowerCase()).digest('hex').slice(0, 16);
    return `\\\\.\\pipe\\grimoire-${id}`;
  }
  return path.join(dataDir, 'service.sock');
}
