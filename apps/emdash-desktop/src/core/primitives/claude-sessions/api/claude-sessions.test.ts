import { describe, expect, it } from 'vitest';
import {
  CLAUDE_SESSION_ACTIVE_WINDOW_MS,
  claudeProjectSlug,
  listClaudeSessions,
  parseClaudeTranscriptHead,
  type ClaudeSessionFs,
} from './claude-sessions';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('claudeProjectSlug', () => {
  it('replaces every non-alphanumeric character with a dash, like Claude Code', () => {
    expect(claudeProjectSlug('/Users/etienne/Documents/Claude/Projects/morax-os')).toBe(
      '-Users-etienne-Documents-Claude-Projects-morax-os'
    );
    expect(claudeProjectSlug('/srv/my repo/.claude/worktrees/feat_x')).toBe(
      '-srv-my-repo--claude-worktrees-feat-x'
    );
  });
});

describe('parseClaudeTranscriptHead', () => {
  it('takes the first typed prompt, cwd and branch, skipping meta and command lines', () => {
    const text = [
      JSON.stringify({ type: 'queue-operation' }),
      JSON.stringify({ type: 'user', isMeta: true, message: { content: 'Caveat: hidden' } }),
      JSON.stringify({
        type: 'user',
        cwd: '/repo',
        gitBranch: 'main',
        message: { content: '<command-name>/clear</command-name>' },
      }),
      JSON.stringify({
        type: 'user',
        cwd: '/repo',
        gitBranch: 'main',
        message: { content: [{ type: 'text', text: '  Fix the\n login bug  ' }] },
      }),
      '{"type":"assistant", truncated',
    ].join('\n');
    expect(parseClaudeTranscriptHead(text)).toEqual({
      firstPrompt: 'Fix the login bug',
      cwd: '/repo',
      gitBranch: 'main',
    });
  });

  it('prefers a summary line and shortens long prompts', () => {
    const long = 'x'.repeat(400);
    const head = parseClaudeTranscriptHead(
      [
        JSON.stringify({ type: 'summary', summary: 'Login refactor' }),
        JSON.stringify({ type: 'user', message: { content: long } }),
      ].join('\n')
    );
    expect(head.summary).toBe('Login refactor');
    expect(head.firstPrompt?.length).toBe(160);
  });
});

function fakeFs(
  dirs: Record<
    string,
    { name: string; kind: 'file' | 'directory'; size?: number; mtimeMs?: number }[]
  >,
  files: Record<string, string>
): ClaudeSessionFs {
  return {
    list: async (path) => (dirs[path] ?? []).map((entry) => ({ size: 1, mtimeMs: 0, ...entry })),
    readHead: async (path) => files[path] ?? '',
  };
}

describe('listClaudeSessions', () => {
  const home = '/home/me';
  const repo = '/home/me/repo';
  const repoSlugDir = `${home}/.claude/projects/${claudeProjectSlug(repo)}`;
  const worktree = `${repo}/.claude/worktrees/brave-otter`;
  const worktreeSlugDir = `${home}/.claude/projects/${claudeProjectSlug(worktree)}`;
  const now = 10_000_000;

  const fs = fakeFs(
    {
      [`${repo}/.claude/worktrees`]: [{ name: 'brave-otter', kind: 'directory' }],
      [repoSlugDir]: [
        { name: `${A}.jsonl`, kind: 'file', size: 2048, mtimeMs: now - 3_600_000 },
        { name: 'notes.txt', kind: 'file', size: 10, mtimeMs: now },
        { name: `${C}.jsonl`, kind: 'file', size: 0, mtimeMs: now },
      ],
      [worktreeSlugDir]: [{ name: `${B}.jsonl`, kind: 'file', size: 4096, mtimeMs: now - 5_000 }],
    },
    {
      [`${repoSlugDir}/${A}.jsonl`]: JSON.stringify({
        type: 'user',
        cwd: repo,
        gitBranch: 'main',
        message: { content: 'Repo session' },
      }),
      [`${worktreeSlugDir}/${B}.jsonl`]: JSON.stringify({
        type: 'user',
        cwd: worktree,
        gitBranch: 'claude/brave-otter',
        message: { content: 'Worktree session' },
      }),
    }
  );

  it('lists repository and worktree sessions newest first and flags live ones', async () => {
    const sessions = await listClaudeSessions(fs, {
      repositoryPath: `${repo}/`,
      homeDir: home,
      nowMs: now,
    });
    expect(sessions.map((s) => s.sessionId)).toEqual([B, A]);
    expect(sessions[0]).toMatchObject({
      cwd: worktree,
      worktreeName: 'brave-otter',
      title: 'Worktree session',
      gitBranch: 'claude/brave-otter',
      isActive: true,
    });
    expect(sessions[1]).toMatchObject({ cwd: repo, worktreeName: null, isActive: false });
    expect(now - sessions[1].lastActivityMs).toBeGreaterThan(CLAUDE_SESSION_ACTIVE_WINDOW_MS);
  });

  it('returns nothing when Claude Code has no transcripts for the repository', async () => {
    expect(
      await listClaudeSessions(fakeFs({}, {}), { repositoryPath: repo, homeDir: home, nowMs: now })
    ).toEqual([]);
  });
});
