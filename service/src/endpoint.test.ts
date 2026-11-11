import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { endpointFor } from './endpoint';

describe('endpointFor', () => {
  it('gives each data directory its own named pipe on Windows, whatever its case', () => {
    const pipe = endpointFor('C:\\Users\\me\\Grimoire', 'win32');
    expect(pipe).toMatch(/^\\\\\.\\pipe\\grimoire-[0-9a-f]{16}$/);
    expect(endpointFor('c:\\users\\me\\grimoire', 'win32')).toBe(pipe);
    expect(endpointFor('C:\\Users\\me\\Grimoire-dev', 'win32')).not.toBe(pipe);
  });

  it('puts a socket in the data directory elsewhere', () => {
    expect(endpointFor('/home/me/.grimoire', 'linux')).toBe(
      path.join('/home/me/.grimoire', 'service.sock'),
    );
  });
});
