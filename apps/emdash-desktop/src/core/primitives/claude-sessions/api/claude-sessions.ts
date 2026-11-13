/**
 * Finds Claude Code sessions started outside Emdash (Claude Desktop "Code" sessions, a
 * terminal `claude`) for a repository, so a task can resume them with `--resume <id>`.
 *
 * Claude Code stores each session as `~/.claude/projects/<slug>/<session-id>.jsonl`, where
 * the slug is the session's working directory with every non-alphanumeric character
 * replaced by `-`. Claude Desktop often runs sessions in `<repo>/.claude/worktrees/<name>`,
 * which have their own slug. A session can only be resumed from its own working directory,
 * on the machine that holds its transcript.
 */

/** Sessions modified more recently than this are probably still open in another app. */
export const CLAUDE_SESSION_ACTIVE_WINDOW_MS = 60_000;
/** Bytes read from the start of each transcript to find its title, cwd and branch. */
export const CLAUDE_TRANSCRIPT_HEAD_BYTES = 64 * 1024;
/** Upper bound on transcripts inspected per listing (newest first). */
export const CLAUDE_SESSION_LIST_LIMIT = 40;
const PROMPT_PREVIEW_CHARS = 160;

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function claudeProjectSlug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-');
}

export function joinHostPath(base: string, ...segments: string[]): string {
  return [base.replace(/\/+$/, ''), ...segments].join('/');
}

export type ClaudeTranscriptHead = {
  firstPrompt?: string;
  summary?: string;
  cwd?: string;
  gitBranch?: string;
};

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
  }
  return undefined;
}

/** True for user lines that are not the person typing (slash-command echoes, reminders). */
function isMachineText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('<') || trimmed.startsWith('Caveat:');
}

function preview(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > PROMPT_PREVIEW_CHARS
    ? `${single.slice(0, PROMPT_PREVIEW_CHARS - 1)}…`
    : single;
}

/** Reads the first lines of a transcript; tolerates a truncated last line. */
export function parseClaudeTranscriptHead(text: string): ClaudeTranscriptHead {
  const head: ClaudeTranscriptHead = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type === 'summary' && typeof entry.summary === 'string' && !head.summary) {
      head.summary = preview(entry.summary);
    }
    if (typeof entry.cwd === 'string' && !head.cwd) head.cwd = entry.cwd;
    if (typeof entry.gitBranch === 'string' && entry.gitBranch && !head.gitBranch) {
      head.gitBranch = entry.gitBranch;
    }
    if (entry.type === 'user' && !entry.isMeta && !head.firstPrompt) {
      const message = entry.message as { content?: unknown } | undefined;
      const text = textOf(message?.content);
      if (text && !isMachineText(text)) head.firstPrompt = preview(text);
    }
    if (head.firstPrompt && head.cwd && head.gitBranch) break;
  }
  return head;
}

export type ClaudeSessionFs = {
  /** Entries of a directory; resolves to [] when it does not exist. */
  list(
    path: string
  ): Promise<{ name: string; kind: 'file' | 'directory'; size: number; mtimeMs: number }[]>;
  /** The first `maxBytes` of a text file. */
  readHead(path: string, maxBytes: number): Promise<string>;
};

export type ClaudeSessionSummary = {
  sessionId: string;
  /** The directory the session ran in (from the transcript, else the slug's directory). */
  cwd: string;
  /** Name of the `.claude/worktrees/<name>` the session ran in, or null for the repository. */
  worktreeName: string | null;
  title: string;
  gitBranch: string | null;
  size: number;
  lastActivityMs: number;
  /** Written to within the last minute: probably still open in another app. */
  isActive: boolean;
};

/** Lists resumable sessions for a repository and its `.claude/worktrees/*`, newest first. */
export async function listClaudeSessions(
  fs: ClaudeSessionFs,
  input: { repositoryPath: string; homeDir: string; nowMs: number }
): Promise<ClaudeSessionSummary[]> {
  const repository = input.repositoryPath.replace(/\/+$/, '');
  const worktreesDir = joinHostPath(repository, '.claude', 'worktrees');
  const worktrees = (await fs.list(worktreesDir)).filter((entry) => entry.kind === 'directory');
  const places = [
    { cwd: repository, worktreeName: null as string | null },
    ...worktrees.map((entry) => ({
      cwd: joinHostPath(worktreesDir, entry.name),
      worktreeName: entry.name,
    })),
  ];

  const projectsDir = joinHostPath(input.homeDir, '.claude', 'projects');
  const files: {
    place: (typeof places)[number];
    path: string;
    sessionId: string;
    size: number;
    mtimeMs: number;
  }[] = [];
  for (const place of places) {
    const dir = joinHostPath(projectsDir, claudeProjectSlug(place.cwd));
    for (const entry of await fs.list(dir)) {
      const match = entry.kind === 'file' ? SESSION_FILE.exec(entry.name) : null;
      if (!match || entry.size === 0) continue;
      files.push({
        place,
        path: joinHostPath(dir, entry.name),
        sessionId: match[1].toLowerCase(),
        size: entry.size,
        mtimeMs: entry.mtimeMs,
      });
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sessions: ClaudeSessionSummary[] = [];
  for (const file of files.slice(0, CLAUDE_SESSION_LIST_LIMIT)) {
    const head = parseClaudeTranscriptHead(
      await fs.readHead(file.path, CLAUDE_TRANSCRIPT_HEAD_BYTES)
    );
    sessions.push({
      sessionId: file.sessionId,
      cwd: head.cwd ?? file.place.cwd,
      worktreeName: file.place.worktreeName,
      title: head.summary ?? head.firstPrompt ?? 'Untitled session',
      gitBranch: head.gitBranch ?? null,
      size: file.size,
      lastActivityMs: file.mtimeMs,
      isActive: input.nowMs - file.mtimeMs < CLAUDE_SESSION_ACTIVE_WINDOW_MS,
    });
  }
  return sessions;
}

export type ResumableClaudeSession = ClaudeSessionSummary & {
  /** Registered workspace at the session's directory; null when that directory is gone. */
  workspaceId: string | null;
};

export type ListClaudeSessionsResult =
  | { kind: 'ok'; sessions: ResumableClaudeSession[] }
  | { kind: 'unavailable'; message: string };
