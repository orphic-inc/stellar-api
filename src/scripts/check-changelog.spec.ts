// Regression coverage for the CLI wrapper around the changelog gate (#386).
//
// changelogGate.spec.ts covers the pure rule. This file covers the thing that
// actually broke twice: how the wrapper GETS the file list. Both defects lived
// here, and both passed every local check, because the bug only appears when the
// writer on the other end of the pipe is slow — `readFileSync(0)` raced a
// `printf` and won, then raced `gh api --paginate` over the network and lost.
//
// So the delay below is the entire point of these tests. A fast writer passes
// with the bug present and proves nothing. Do not "optimise" it away.
//
// This is the repo's only child-process spec. It shells out because the failure
// is a property of a real fd 0 with a real pipe on it, which cannot be faked
// in-process. `spawn`, not `spawnSync`: spawnSync's `input:` writes and closes
// immediately, which is exactly the passing case.
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, 'check-changelog.ts');
const REGISTER = require.resolve('ts-node/register/transpile-only');

/** Longer than ts-node's startup, so the script reaches its read before we write. */
const WRITER_DELAY_MS = 2000;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the real script in stdin mode, writing `list` only after `delayMs`.
 *
 * Invoked through `process.execPath` + ts-node's register hook rather than
 * `npm run`, to keep npm's own argv handling — the *first* bug — out of the
 * measurement of the second.
 */
const runWithDelayedStdin = (
  list: string,
  delayMs: number,
  extraEnv: Record<string, string> = {}
): Promise<Run> =>
  new Promise((res, rej) => {
    const child = spawn(process.execPath, ['-r', REGISTER, SCRIPT], {
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, CHANGELOG_STDIN: '1', ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', rej);

    const timer = setTimeout(() => {
      child.stdin.write(list);
      child.stdin.end();
    }, delayMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });

/**
 * A base CHANGELOG with an empty `[Unreleased]`, so the preservation half of the
 * gate has nothing to protect and these tests stay about the thing they are
 * about — how the wrapper gets its file list. Preservation itself is covered in
 * lib/changelogGate.spec.ts.
 */
const emptyBaseChangelog = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-gate-'));
  const file = join(dir, 'base.md');
  writeFileSync(
    file,
    '# Changelog\n\n## [Unreleased]\n\n## [0.8.3] — 2026-08-30\n'
  );
  return file;
};

describe('check-changelog CLI, stdin mode', () => {
  const BASE = { CHANGELOG_BASE_FILE: emptyBaseChangelog() };

  it('honours a slowly-written file list rather than falling back to git', async () => {
    // The load-bearing case. `src/zzz.ts` obliges an entry and no CHANGELOG.md
    // accompanies it, so the only correct verdict is a failure naming that path.
    //
    // With the fd-0 bug present this exited 0 — the read threw EAGAIN, the throw
    // was swallowed to '', and the empty result fell back to the working tree,
    // whose state happens to satisfy the gate. A green run against files the
    // caller never asked about.
    const { code, stderr } = await runWithDelayedStdin(
      'src/zzz.ts\n',
      WRITER_DELAY_MS
    );

    expect(code).toBe(1);
    expect(stderr).toContain('src/zzz.ts');
    // Proof it read the pipe and not the tree: nothing in this repo's working
    // tree is named zzz.ts, and a fallback run would have reported other paths.
    expect(stderr).not.toContain('check-changelog.ts');
  }, 20000);

  it('passes a slowly-written list that does update the changelog', async () => {
    // The mirror, so the test above cannot be satisfied by simply failing shut.
    const { code, stdout } = await runWithDelayedStdin(
      'src/zzz.ts\nCHANGELOG.md\n',
      WRITER_DELAY_MS,
      BASE
    );

    expect(code).toBe(0);
    expect(stdout).toContain('1 shipping-code change');
  }, 20000);

  it('reports the gate as not engaged for a slowly-written docs-only list', async () => {
    const { code, stdout } = await runWithDelayedStdin(
      'docs/agents/handoff.md\n',
      WRITER_DELAY_MS,
      BASE
    );

    expect(code).toBe(0);
    expect(stdout).toContain('not engaged');
  }, 20000);

  it('refuses to run without a base changelog rather than skipping the check', async () => {
    // The preservation half needs the base file, and CI is the only caller that
    // has to supply it. Passing here would mean reporting a clean bill of health
    // on a check that never executed — the exact failure mode this whole gate
    // exists to prevent, one level up. Exit 2, not 1: a caller error, not a
    // verdict about the changelog.
    const { code, stderr } = await runWithDelayedStdin(
      'CHANGELOG.md\n',
      WRITER_DELAY_MS,
      { CHANGELOG_BASE_FILE: '' }
    );

    expect(code).toBe(2);
    expect(stderr).toContain('CHANGELOG_BASE_FILE');
  }, 20000);
});
