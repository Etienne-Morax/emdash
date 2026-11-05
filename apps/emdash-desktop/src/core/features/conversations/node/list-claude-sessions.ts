import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { and, eq, isNull } from 'drizzle-orm';
import type { ConversationsRuntimeBroker } from '@core/features/conversations/api/runtime-adapter';
import {
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import {
  listClaudeSessions,
  type ClaudeSessionFs,
  type ListClaudeSessionsResult,
} from '@core/primitives/claude-sessions/api/claude-sessions';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects } from '@core/services/app-db/node/schema';

const normalize = (path: string) => path.replace(/\/+$/, '');

/**
 * Claude Code sessions recorded for a project's repository (and its `.claude/worktrees/*`)
 * on the project's host. Reads transcripts through the host's files runtime, so SSH
 * projects list the remote machine's sessions.
 */
export async function listClaudeSessionsForProject(
  db: AppDb,
  runtimes: ConversationsRuntimeBroker,
  projectId: string,
  nowMs: number = Date.now()
): Promise<ListClaudeSessionsResult> {
  const [project] = await db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const repositoryId = project?.repositoryWorkspaceId;
  if (!repositoryId) return { kind: 'unavailable', message: 'This project has no repository.' };

  const family = await db
    .select({
      id: workspaces.id,
      parentId: workspaces.parentId,
      path: workspaces.path,
      location: workspaces.location,
      sshConnectionId: workspaces.sshConnectionId,
    })
    .from(workspaces)
    .where(liveWorkspaces());
  const repository = family.find((row) => row.id === repositoryId);
  if (!repository?.path) {
    return { kind: 'unavailable', message: 'The project repository path is unknown.' };
  }

  const host =
    repository.location === 'remote' && repository.sshConnectionId
      ? hostRef('remote', repository.sshConnectionId)
      : LOCAL_HOST_REF;
  const client = await runtimes.client(host);
  if (!client.success) return { kind: 'unavailable', message: client.error.message };
  const files = client.data.files;

  const fs: ClaudeSessionFs = {
    list: async (path) => {
      const listed = await files.fs.listDirectory({ path: hostPathFromNative(path) });
      if (!listed.success) return [];
      return listed.data.entries.flatMap((entry) =>
        entry.kind === 'file' || entry.kind === 'directory'
          ? [{ name: entry.name, kind: entry.kind, size: entry.size, mtimeMs: entry.mtimeMs }]
          : []
      );
    },
    readHead: async (path, maxBytes) => {
      const read = await files.fs.readText({
        path: hostPathFromNative(path),
        options: { maxBytes },
      });
      return read.success ? read.data.content : '';
    },
  };

  const homeDir = nativePathFromHost((await files.getHomeDir()).path);
  const sessions = await listClaudeSessions(fs, {
    repositoryPath: repository.path,
    homeDir,
    nowMs,
  });

  const workspaceByPath = new Map<string, string>();
  for (const row of family) {
    if (!row.path) continue;
    if (row.id === repositoryId || row.parentId === repositoryId) {
      workspaceByPath.set(normalize(row.path), row.id);
    }
  }
  return {
    kind: 'ok',
    sessions: sessions.map((session) => ({
      ...session,
      workspaceId: workspaceByPath.get(normalize(session.cwd)) ?? null,
    })),
  };
}
