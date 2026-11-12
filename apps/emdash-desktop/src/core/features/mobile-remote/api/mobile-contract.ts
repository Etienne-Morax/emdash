import { hostRefSchema } from '@emdash/core/primitives/host/api';
import { gitFilePathSchema } from '@emdash/core/runtimes/git/api';
import { defineContract, fallible, liveJob, liveModel, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { agentsContract } from '@core/features/agents/api/contract';
import { conversationsContract } from '@core/features/conversations/api/contract';
import { projectsWireContract } from '@core/features/projects/api/wire-contract';
import { sourceControlContract } from '@core/features/source-control/api/contract';
import { tasksWireContract } from '@core/features/tasks/api/wire-contract';
import { workspacesWireContract } from '@core/features/workspaces/api/wire-contract';
import { hostsContract } from '@core/services/hosts/api/contract';
import { notificationsContract } from '@core/services/notifications/api/contract';
import {
  mobileAppearanceSchema,
  mobileDeviceSessionSchema,
  mobileMachineSchema,
  mobilePullRequestErrorSchema,
  mobilePullRequestSchema,
  mobilePushSubscriptionSchema,
  mobileTaskDefaultsSchema,
} from './schemas';

/**
 * The Wire contract the phone may call: an allowlist by construction.
 *
 * Every endpoint below sits at the same path as its desktop counterpart, so the gateway
 * forwards it unchanged to the desktop controllers. Anything absent here — file writes,
 * secrets, settings, SSH credentials, MCP, updates, logs, provider spawn parameters — does
 * not exist for the phone: the gateway's controller answers NOT_FOUND / UNKNOWN_TOPIC.
 *
 * Live models are redeclared **without mutations** (reads only). Procedures whose desktop
 * input is `z.custom` (unvalidated) are redeclared with strict schemas.
 */

/** Longest prompt accepted from the phone. */
export const MOBILE_PROMPT_MAX_LENGTH = 20_000;
/** Longest raw terminal input in one call (a paste). */
export const MOBILE_TERMINAL_INPUT_MAX_LENGTH = 64 * 1024;
const NAME_MAX_LENGTH = 200;
const TERMINAL_MAX_DIMENSION = 1_000;

/**
 * A git branch name the phone may ask for. Git re-validates it; this only refuses names
 * that could be read as command-line options or walk up refs.
 */
export const mobileBranchNameSchema = z
  .string()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .regex(/^[A-Za-z0-9._/+-]+$/)
  .refine((name) => !name.startsWith('-') && !name.includes('..'), 'invalid branch name');

/**
 * A git remote name. Never a path or URL: git reads an unknown `<remote>` argument as a
 * repository location, so `/`, `:` and a leading `.` are refused.
 */
export const mobileRemoteNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/)
  .refine((name) => !name.includes('..') && !name.endsWith('.lock'), 'invalid remote name');

const remoteSchema = z.object({ name: mobileRemoteNameSchema, url: z.string().max(2_048) });

/** The only workspace shape the phone creates: a new worktree on a new branch. */
const mobileWorkspaceConfigSchema = z.object({
  version: z.literal('2'),
  git: z.object({
    kind: z.literal('create-branch'),
    branchName: mobileBranchNameSchema,
    fromBranch: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('local'),
        branch: mobileBranchNameSchema,
        remote: remoteSchema.optional(),
      }),
      z.object({ type: z.literal('remote'), branch: mobileBranchNameSchema, remote: remoteSchema }),
    ]),
    pushBranch: z.boolean().optional(),
  }),
  workspace: z.object({ kind: z.literal('new-worktree') }),
});

const mobileTaskConfigSchema = z.object({
  version: z.literal('1'),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  initialConversation: z.object({
    id: z.string().uuid(),
    provider: z.string().min(1).max(64),
    title: z.string().max(NAME_MAX_LENGTH).optional(),
    // Several agents take the prompt as a positional CLI argument: a leading '-' would be
    // read as an option (e.g. one that disables permission prompts).
    initialPrompt: z
      .string()
      .max(MOBILE_PROMPT_MAX_LENGTH)
      .refine((prompt) => !prompt.trimStart().startsWith('-'), 'prompt cannot start with "-"')
      .optional(),
    type: z.enum(['pty', 'acp']).optional(),
  }),
});

export const mobileCreateTaskInputSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  taskConfig: mobileTaskConfigSchema,
  workspaceConfig: mobileWorkspaceConfigSchema,
});

export type MobileCreateTaskInput = z.infer<typeof mobileCreateTaskInputSchema>;

/** Longest pull request title and description accepted from the phone. */
export const MOBILE_PR_TITLE_MAX_LENGTH = 256;
export const MOBILE_PR_BODY_MAX_LENGTH = 20_000;
/** Most commits the phone may list in one call (to find a branch's merge base). */
export const MOBILE_LOG_LIMIT_MAX = 500;

/** A full or abbreviated commit id: never an option, a range or a revision expression. */
const commitShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/);

/** A branch name only: not a full ref (`refs/tags/…`, `refs/stash`) nor a symbolic ref. */
const reviewBranchNameSchema = mobileBranchNameSchema.refine(
  (name) => !name.startsWith('refs/') && !/^(?:[A-Z_]*HEAD)$/.test(name),
  'not a branch name'
);

/** The refs the phone may name when reading a checkout: branches and commits, no tags. */
const mobileObjectRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('branch'),
    branch: z.discriminatedUnion('type', [
      z.object({ type: z.literal('local'), branch: reviewBranchNameSchema }),
      z.object({ type: z.literal('remote'), branch: reviewBranchNameSchema, remote: remoteSchema }),
    ]),
  }),
  z.object({ kind: z.literal('commit'), sha: commitShaSchema }),
]);

const workspaceKeySchema = z.object({ workspaceId: z.string().min(1) });

/** Opens a pull request for a task branch; the repository is resolved by the desktop. */
export const mobileCreatePullRequestInputSchema = z.object({
  projectId: z.string().min(1),
  head: mobileBranchNameSchema,
  base: mobileBranchNameSchema,
  title: z.string().trim().min(1).max(MOBILE_PR_TITLE_MAX_LENGTH),
  body: z.string().max(MOBILE_PR_BODY_MAX_LENGTH).optional(),
  draft: z.boolean(),
});

export type MobileCreatePullRequestInput = z.infer<typeof mobileCreatePullRequestInputSchema>;

const conversationKeySchema = z.object({ conversationId: z.string().min(1) });
const terminalSizeSchema = z.object({
  cols: z.number().int().min(1).max(TERMINAL_MAX_DIMENSION),
  rows: z.number().int().min(1).max(TERMINAL_MAX_DIMENSION),
});
const HISTORY_PAGE_MAX = 200;

const tui = conversationsContract.tui;
const acp = conversationsContract.acp;
const repository = sourceControlContract.repository;
const checkout = sourceControlContract.checkout;

export const mobileWireContract = defineContract({
  /** Served by the gateway itself, per paired device. */
  mobile: defineContract({
    session: procedure({ input: z.void().optional(), output: mobileDeviceSessionSchema }),
    machines: procedure({ input: z.void().optional(), output: z.array(mobileMachineSchema) }),
    appearance: procedure({ input: z.void().optional(), output: mobileAppearanceSchema }),
    taskDefaults: procedure({ input: z.void().optional(), output: mobileTaskDefaultsSchema }),
    pullRequests: defineContract({
      /** Pull requests whose head is `branch` in the project's repository. */
      forBranch: fallible({
        input: z.object({ projectId: z.string().min(1), branch: mobileBranchNameSchema }),
        data: z.object({ prs: z.array(mobilePullRequestSchema) }),
        error: mobilePullRequestErrorSchema,
      }),
      create: fallible({
        input: mobileCreatePullRequestInputSchema,
        data: z.object({ url: z.string(), number: z.number().int().positive() }),
        error: mobilePullRequestErrorSchema,
      }),
    }),
    push: defineContract({
      /** VAPID application server key for `pushManager.subscribe`. */
      publicKey: procedure({
        input: z.void().optional(),
        output: z.object({ publicKey: z.string() }),
      }),
      subscribe: procedure({ input: mobilePushSubscriptionSchema, output: z.void() }),
      unsubscribe: procedure({
        input: z.object({ endpoint: z.string().url().max(2_048) }),
        output: z.void(),
      }),
    }),
  }),
  projects: defineContract({
    projectList: liveModel({
      key: z.void(),
      states: { list: projectsWireContract.projectList.states.list },
    }),
  }),
  hosts: defineContract({
    availability: liveModel({
      key: z.object({ host: hostRefSchema }),
      states: { state: hostsContract.availability.states.state },
    }),
  }),
  tasks: defineContract({
    taskList: liveModel({
      key: z.object({ projectId: z.string() }),
      states: { list: tasksWireContract.taskList.states.list },
    }),
    generateTaskName: procedure({
      input: z.object({
        title: z.string().max(NAME_MAX_LENGTH).optional(),
        description: z.string().max(MOBILE_PROMPT_MAX_LENGTH).optional(),
      }),
      output: tasksWireContract.generateTaskName.output,
    }),
    createTask: procedure({
      input: mobileCreateTaskInputSchema,
      output: tasksWireContract.createTask.output,
    }),
  }),
  workspaces: defineContract({
    /**
     * Activates a task's workspace and session on its host, as the desktop does when a task
     * is opened. Required before an agent can be hydrated.
     */
    provision: workspacesWireContract.provision,
  }),
  agents: defineContract({
    /** Static plugin metadata (names, icons); identical on every host. */
    listMetadata: agentsContract.listMetadata,
  }),
  sourceControl: defineContract({
    repository: defineContract({
      model: liveModel({
        key: z.object({ projectId: z.string() }),
        states: { refs: repository.model.states.refs },
      }),
      getDefaultBranch: repository.getDefaultBranch,
    }),
    /** A task checkout, read-only except for publishing (never force-pushing) its branch. */
    checkout: defineContract({
      model: liveModel({ key: workspaceKeySchema, states: { head: checkout.model.states.head } }),
      getChangedFiles: procedure({
        input: workspaceKeySchema.extend({
          target: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('working-vs-head') }),
            z.object({
              kind: z.literal('merge-base'),
              base: mobileObjectRefSchema,
              head: mobileObjectRefSchema,
            }),
          ]),
        }),
        output: checkout.getChangedFiles.output,
      }),
      /** Committed content only (a git object): working-tree files are never read. */
      getFile: procedure({
        input: workspaceKeySchema.extend({
          path: gitFilePathSchema,
          source: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('head') }),
            z.object({ kind: z.literal('revision'), revision: mobileObjectRefSchema }),
          ]),
        }),
        output: checkout.getFile.output,
      }),
      getLog: procedure({
        input: workspaceKeySchema.extend({
          options: z.object({
            limit: z.number().int().min(1).max(MOBILE_LOG_LIMIT_MAX),
            base: mobileObjectRefSchema,
            head: mobileObjectRefSchema,
          }),
        }),
        output: checkout.getLog.output,
      }),
      /** Pushes the task branch to `remote` under its own name and tracks it. Never forced. */
      publish: liveJob({
        input: workspaceKeySchema.extend({ remote: mobileRemoteNameSchema }).strict(),
        progress: checkout.publish.progress,
        result: checkout.publish.result,
        error: checkout.publish.error,
      }),
    }),
  }),
  conversations: defineContract({
    getConversationsForTask: conversationsContract.getConversationsForTask,
    getConversationsForProject: conversationsContract.getConversationsForProject,
    markConversationSeen: conversationsContract.markConversationSeen,
    /** Starts or resumes the agent with the desktop-resolved launch config. */
    hydrateConversation: procedure({
      input: z.object({
        projectId: z.string().min(1),
        taskId: z.string().min(1),
        conversationId: z.string().min(1),
        initialSize: terminalSizeSchema.optional(),
      }),
      output: conversationsContract.hydrateConversation.output,
    }),
    events: conversationsContract.events,
    tui: defineContract({
      output: tui.output,
      sendInput: procedure({
        input: conversationKeySchema.extend({
          data: z.string().min(1).max(MOBILE_TERMINAL_INPUT_MAX_LENGTH),
        }),
        output: tui.sendInput.output,
      }),
      resize: procedure({
        input: conversationKeySchema.extend(terminalSizeSchema.shape),
        output: tui.resize.output,
      }),
      stop: tui.stop,
    }),
    acp: defineContract({
      attach: acp.attach,
      session: acp.session,
      sendPrompt: acp.sendPrompt,
      cancelTurn: acp.cancelTurn,
      resolvePermission: acp.resolvePermission,
      loadHistory: procedure({
        input: z.object({
          conversationId: z.string().min(1),
          before: z.number().int().optional(),
          limit: z.number().int().min(1).max(HISTORY_PAGE_MAX),
        }),
        output: acp.loadHistory.output,
      }),
    }),
  }),
  notifications: defineContract({
    feed: liveModel({
      key: z.void().optional(),
      states: { list: notificationsContract.feed.states.list },
    }),
  }),
});

export type MobileWireContract = typeof mobileWireContract;
