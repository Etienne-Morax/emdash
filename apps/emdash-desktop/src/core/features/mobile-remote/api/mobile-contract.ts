import { hostRefSchema } from '@emdash/core/primitives/host/api';
import { defineContract, liveModel, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { conversationsContract } from '@core/features/conversations/api/contract';
import { projectsWireContract } from '@core/features/projects/api/wire-contract';
import { sourceControlContract } from '@core/features/source-control/api/contract';
import { tasksWireContract } from '@core/features/tasks/api/wire-contract';
import { hostsContract } from '@core/services/hosts/api/contract';
import { notificationsContract } from '@core/services/notifications/api/contract';
import { mobileAppearanceSchema, mobileDeviceSessionSchema, mobileMachineSchema } from './schemas';

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

const remoteSchema = z.object({ name: mobileBranchNameSchema, url: z.string().max(2_048) });

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

const conversationKeySchema = z.object({ conversationId: z.string().min(1) });
const terminalSizeSchema = z.object({
  cols: z.number().int().min(1).max(TERMINAL_MAX_DIMENSION),
  rows: z.number().int().min(1).max(TERMINAL_MAX_DIMENSION),
});
const HISTORY_PAGE_MAX = 200;

const tui = conversationsContract.tui;
const acp = conversationsContract.acp;
const repository = sourceControlContract.repository;

export const mobileWireContract = defineContract({
  /** Served by the gateway itself, per paired device. */
  mobile: defineContract({
    session: procedure({ input: z.void().optional(), output: mobileDeviceSessionSchema }),
    machines: procedure({ input: z.void().optional(), output: z.array(mobileMachineSchema) }),
    appearance: procedure({ input: z.void().optional(), output: mobileAppearanceSchema }),
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
    createTask: procedure({
      input: mobileCreateTaskInputSchema,
      output: tasksWireContract.createTask.output,
    }),
  }),
  sourceControl: defineContract({
    repository: defineContract({
      model: liveModel({
        key: z.object({ projectId: z.string() }),
        states: { refs: repository.model.states.refs },
      }),
      getDefaultBranch: repository.getDefaultBranch,
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
