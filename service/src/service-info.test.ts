import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROTOCOL_VERSION, type ServiceInfo } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeServiceInfo, writeServiceInfo } from './service-info';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-info-'));
  file = path.join(dir, 'service.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const info = (pid: number): ServiceInfo => ({
  endpoint: 'pipe',
  token: 'secret',
  pid,
  buildId: 'dev',
  protocolVersion: PROTOCOL_VERSION,
});

describe('service.json', () => {
  it('is written whole, with nothing left beside it', () => {
    writeServiceInfo(file, info(1));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(info(1));
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('is removed by the service that wrote it, not by one it was replaced by', () => {
    writeServiceInfo(file, info(2));
    removeServiceInfo(file, 1);
    expect(existsSync(file)).toBe(true);
    removeServiceInfo(file, 2);
    expect(existsSync(file)).toBe(false);
    expect(() => removeServiceInfo(file, 2)).not.toThrow();
  });
});
