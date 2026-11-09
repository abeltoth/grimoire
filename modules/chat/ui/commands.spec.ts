import { deedOf } from './commands';

describe('deedOf', () => {
  it.each([
    ['cat package.json', 'read'],
    ['cd /repo && sed -n 1,40p src/a.ts', 'read'],
    ['head -30 a.ts | grep foo', 'read'],
    ['grep -rn "lines shown\|fold-out" src | head', 'searched'],
    ['ls modules && find . -name "*.ts"', 'searched'],
    ['git grep meter', 'searched'],
    ['npm test -w @grimoire/ui -- --watch=false 2>&1 | grep -E "Tests"', 'tested'],
    ['cd /repo && npx vitest run a.spec.ts', 'tested'],
    [
      'git add a.ts b.ts && git commit -q -m "Fix" && git push -q; git log --oneline -1',
      'committed',
    ],
    ['git -C /repo commit -m x', 'committed'],
    ['git status --short', 'ran'],
    ['sed -i "s/a/b/" a.ts', 'ran'],
    ["cat > a.ts <<'EOF'\ngrep inside the text\nEOF", 'ran'],
    ['cat a.ts && npm test', 'ran'],
    ['npm run build', 'ran'],
    ["python - <<'EOF'\ncat = open('a')\nEOF\ngrep -n x a.ts", 'ran'],
  ])('%s → %s', (command, deed) => {
    expect(deedOf(command)).toBe(deed);
  });
});
