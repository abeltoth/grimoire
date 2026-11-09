// npm run service:stop [-- <profile>]
// Stops the background service that keeps running after the app quits.
// The profile defaults to "Grimoire Dev"; use "Grimoire" for the installed app.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const profile = process.argv[2] ?? 'Grimoire Dev';
const appData =
  process.platform === 'win32'
    ? process.env.APPDATA
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));

let info;
try {
  info = JSON.parse(readFileSync(path.join(appData, profile, 'service.json'), 'utf8'));
} catch {
  console.log(`No service is running for "${profile}".`);
  process.exit(0);
}

const socket = net.createConnection(info.endpoint);
let failed = false;
socket.on('connect', () => {
  socket.write(
    JSON.stringify({ kind: 'hello', token: info.token, protocolVersion: info.protocolVersion }) +
      '\n',
  );
  socket.write(JSON.stringify({ kind: 'shutdown' }) + '\n');
});
socket.on('error', (error) => {
  failed = true;
  console.log(`No service is answering for "${profile}" (${error.code}).`);
});
socket.on('close', () => {
  if (!failed) console.log(`Stopped the "${profile}" service (pid ${info.pid}).`);
});
