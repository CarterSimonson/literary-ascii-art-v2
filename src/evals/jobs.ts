// One background job at a time for the rating page: writing and generating a
// round, retrying failures, or replacing an idea. Each uses Codex, so running
// them one after another keeps usage and output predictable.

export interface JobStatus {
  busy: boolean;
  kind: string | null;
  round: string | null;
  message: string;
  error: string | null;
  updated_at: string;
}

export interface JobReport {
  message: string;
  round?: string;
}

export type JobTask = (report: (update: JobReport) => void) => Promise<string>;

export interface JobRunner {
  status: () => JobStatus;
  start: (kind: string, task: JobTask) => void;
  // Resolves when the current job settles; for tests and shutdown.
  idle: () => Promise<void>;
}

export function createJobRunner(): JobRunner {
  let current: JobStatus = {
    busy: false,
    kind: null,
    round: null,
    message: "Idle",
    error: null,
    updated_at: new Date().toISOString(),
  };
  let running: Promise<void> = Promise.resolve();

  const update = (changes: Partial<JobStatus>): void => {
    current = { ...current, ...changes, updated_at: new Date().toISOString() };
  };

  const start = (kind: string, task: JobTask): void => {
    if (current.busy) {
      throw new Error(`Busy: ${current.message}`);
    }

    update({ busy: true, kind, round: null, message: "Starting", error: null });

    const report = (progress: JobReport): void => {
      update({
        message: progress.message,
        ...(progress.round ? { round: progress.round } : {}),
      });
    };

    running = task(report).then(
      (message) => {
        update({ busy: false, message });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        update({ busy: false, message: "Failed", error: message });
      },
    );
  };

  return {
    status: () => current,
    start,
    idle: () => running,
  };
}
