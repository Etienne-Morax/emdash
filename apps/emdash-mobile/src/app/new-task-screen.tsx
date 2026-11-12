import type { MobileTaskDefaults } from '@core/features/mobile-remote/api/schemas';
import type { AgentMetadata } from '@core/primitives/agents/api/agent-payload';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  baseBranchOptions,
  buildCreateTaskInput,
  defaultBaseBranch,
  fallbackTaskName,
} from '../model/new-task';
import { machineChipFor } from '../model/task-board';
import { getLink } from '../wire/connection';
import { useBranchRefs, useProjects } from '../wire/live';
import { provisionTask } from '../wire/provision';
import { LinkBanner, MachineChip, ScreenHeader } from './components';
import { navigate, routeHref } from './router';
import { useDesktopInfo } from './use-board';
import { useLinkState } from './use-link-state';

const SUFFIX_LENGTH = 5;

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH));
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('');
}

/**
 * Start an agent in any repository of any machine: the same `tasks.createTask` call as the
 * desktop's Create Task modal (new worktree on a new branch from the chosen base).
 */
export function NewTaskScreen() {
  const link = useLinkState();
  const info = useDesktopInfo();
  const projects = useProjects();
  const projectList = projects.value?.projects ?? [];
  const [projectId, setProjectId] = useState<string>('');
  const refs = useBranchRefs(projectId || null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [baseId, setBaseId] = useState('');
  const [agents, setAgents] = useState<AgentMetadata[]>([]);
  const [defaults, setDefaults] = useState<MobileTaskDefaults | null>(null);
  const [provider, setProvider] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const suffix = useMemo(randomSuffix, []);
  const client = getLink().client;

  useEffect(() => {
    void Promise.all([client.agents.listMetadata(), client.mobile.taskDefaults()])
      .then(([metadata, taskDefaults]) => {
        setAgents(metadata);
        setDefaults(taskDefaults);
        setProvider((current) => current || taskDefaults.defaultAgent);
      })
      .catch(() => setError('Could not load agents.'));
  }, [client]);

  useEffect(() => {
    if (!projectId && projectList[0]) setProjectId(projectList[0].id);
  }, [projectId, projectList]);

  useEffect(() => {
    setDefaultBranch(null);
    setBaseId('');
    if (!projectId) return;
    void client.sourceControl.repository
      .getDefaultBranch({ projectId, remote: 'origin' })
      .then((result) => {
        if (result.success) setDefaultBranch(result.data.branch);
      })
      .catch(() => undefined);
  }, [client, projectId]);

  const options = useMemo(() => baseBranchOptions(refs.value), [refs.value]);
  const base =
    options.find((option) => option.id === baseId) ?? defaultBaseBranch(options, defaultBranch);
  const project = projectList.find((entry) => entry.id === projectId);
  const canCreate = Boolean(project && base && provider && defaults && !busy);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!project || !base || !defaults || busy) return;
    if (prompt.trimStart().startsWith('-')) {
      setError('Start the prompt with a word, not "-".');
      return;
    }
    setBusy(true);
    setError(undefined);
    const generated = await client.tasks
      .generateTaskName({ description: prompt.slice(0, 2_000) })
      .catch(() => '');
    const taskName = generated.trim() || fallbackTaskName(prompt);
    const input = buildCreateTaskInput({
      projectId: project.id,
      taskName,
      base,
      provider,
      prompt,
      defaults,
      suffix,
      ids: { task: crypto.randomUUID(), conversation: crypto.randomUUID() },
    });
    const result = await client.tasks.createTask(input).catch(() => null);
    setBusy(false);
    if (!result) {
      setError('Emdash is out of reach. Try again.');
      return;
    }
    if (!result.success) {
      setError(createTaskErrorMessage(result.error));
      return;
    }
    const created = result.data.task;
    // The desktop provisions right after creating; the task screen does it on open too.
    if (created.workspaceId) void provisionTask(created.workspaceId, created.id);
    navigate({ name: 'task', projectId: project.id, taskId: created.id });
  };

  return (
    <main className="screen">
      <ScreenHeader
        back={
          <a className="back-link" href={routeHref({ name: 'home' })} aria-label="Back to tasks">
            ‹
          </a>
        }
        eyebrow="Start an agent"
        title="New task"
      />
      <LinkBanner link={link} />
      <form className="morax-glass new-task-form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="morax-eyebrow">Project</span>
          <select
            className="select-input"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projectList.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} — {machineChipFor(entry, info.machines, info.appearance).name}
              </option>
            ))}
          </select>
        </label>
        {project && (
          <div className="field-inline">
            <span className="morax-eyebrow">Machine</span>
            <MachineChip machine={machineChipFor(project, info.machines, info.appearance)} />
          </div>
        )}
        <label className="field">
          <span className="morax-eyebrow">Base branch</span>
          <select
            className="select-input"
            value={base?.id ?? ''}
            onChange={(event) => setBaseId(event.target.value)}
            disabled={options.length === 0}
          >
            {options.length === 0 && (
              <option value="">{refs.isLoading ? 'Loading…' : 'No branch'}</option>
            )}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="morax-eyebrow">Agent</span>
          <select
            className="select-input"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="morax-eyebrow">What should the agent do?</span>
          <textarea
            className="composer-input prompt-input"
            rows={5}
            value={prompt}
            maxLength={20_000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the task. Dictation works here."
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button-accent" disabled={!canCreate}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </form>
    </main>
  );
}

function createTaskErrorMessage(error: { type: string; message?: string }): string {
  switch (error.type) {
    case 'project-unavailable':
      return 'The machine of this project is not reachable right now.';
    case 'initial-commit-required':
      return 'The repository has no commit yet.';
    case 'branch-not-found':
      return 'The base branch no longer exists.';
    default:
      return error.message ?? `Could not create the task (${error.type}).`;
  }
}
