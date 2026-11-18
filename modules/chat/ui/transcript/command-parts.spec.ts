import { commandParts } from './command-parts';

describe('commandParts', () => {
  it('leaves a command without a heredoc as it is', () => {
    expect(commandParts('npm test && git push', 'bash')).toEqual({
      command: 'npm test && git push',
      scripts: [],
    });
  });

  it('sets a heredoc apart as a script in the language of what reads it', () => {
    const command = [
      "cd /repo && python - <<'EOF'",
      'def edit(p):',
      '    pass',
      'EOF',
      'sed -n 1,5p a.ts',
    ].join('\n');
    expect(commandParts(command, 'bash')).toEqual({
      command: "cd /repo && python - <<'EOF'\nsed -n 1,5p a.ts",
      scripts: [{ label: 'python', lang: 'python', code: 'def edit(p):\n    pass' }],
    });
  });

  it('names a script by the file it writes, in that file’s language', () => {
    expect(commandParts('cat > src/a.ts <<EOF\nexport const a = 1;\nEOF', 'bash').scripts).toEqual([
      { label: 'a.ts', lang: 'typescript', code: 'export const a = 1;' },
    ]);
    expect(commandParts('tee notes.md <<"END" >/dev/null\n# Hi\nEND', 'bash').scripts).toEqual([
      { label: 'notes.md', lang: 'markdown', code: '# Hi' },
    ]);
  });

  it('reads a commit message as a message, and a PR body as markdown', () => {
    const commit = 'git commit -m "$(cat <<\'EOF\'\nFix it\n\nMore\nEOF\n)"';
    expect(commandParts(commit, 'bash')).toEqual({
      command: 'git commit -m "$(cat <<\'EOF\'\n)"',
      scripts: [{ label: 'message', lang: '', code: 'Fix it\n\nMore' }],
    });
    expect(
      commandParts('gh pr create --body "$(cat <<\'EOF\'\n## Summary\nEOF\n)"', 'bash').scripts[0],
    ).toMatchObject({ label: 'body', lang: 'markdown' });
  });

  it('closes a <<- heredoc on a line indented with tabs, and leaves <<< alone', () => {
    expect(commandParts('bash <<-X\n\techo hi\n\tX', 'bash').scripts).toEqual([
      { label: 'bash', lang: 'bash', code: '\techo hi' },
    ]);
    expect(commandParts('cat <<< "hi"', 'bash').scripts).toEqual([]);
  });

  it('leaves an unclosed heredoc in the command', () => {
    expect(commandParts("node <<'EOF'\nconsole.log(1)", 'bash')).toEqual({
      command: "node <<'EOF'\nconsole.log(1)",
      scripts: [],
    });
  });

  it('sets a PowerShell here-string apart, keeping what follows its close', () => {
    expect(commandParts("git commit -m @'\nFix it\n'@", 'powershell')).toEqual({
      command: "git commit -m @'",
      scripts: [{ label: 'message', lang: '', code: 'Fix it' }],
    });
    expect(commandParts('@\'\n{ "a": 1 }\n\'@ | Set-Content out.json', 'powershell')).toEqual({
      command: "@'\n'@ | Set-Content out.json",
      scripts: [{ label: 'out.json', lang: 'json', code: '{ "a": 1 }' }],
    });
  });
});
