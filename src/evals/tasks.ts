// Background work started from the rating page. Tasks run in parallel; a
// task's key prevents duplicates (the same image or idea twice), and
// conflicting kinds wait their turn: a new round never starts while ideas are
// being replaced, and ideas are not replaced while a round is being planned.

export type TaskKind =
  "next-round" | "replace-idea" | "regenerate" | "resume" | "judge";

export interface TaskStatus {
  id: number;
  kind: TaskKind;
  key: string;
  label: string;
  state: "running" | "done" | "failed";
  message: string;
  error: string | null;
  round: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface TaskReport {
  message: string;
  round?: string;
}

export interface StartTaskArgs {
  kind: TaskKind;
  key: string;
  label: string;
  run: (report: (update: TaskReport) => void) => Promise<string>;
}

export interface TaskRunner {
  list: () => TaskStatus[];
  start: (args: StartTaskArgs) => TaskStatus;
  // Resolves when every running task settles; for tests and shutdown.
  idle: () => Promise<void>;
}

const CONFLICTS: Record<TaskKind, TaskKind[]> = {
  "next-round": ["next-round", "replace-idea"],
  "replace-idea": ["next-round"],
  regenerate: [],
  resume: [],
  judge: [],
};

// Finished tasks stay listed so failures remain visible.
const HISTORY_LIMIT = 30;

export function createTaskRunner(): TaskRunner {
  const tasks: TaskStatus[] = [];
  const running = new Map<number, Promise<void>>();
  let nextId = 1;

  const start = (args: StartTaskArgs): TaskStatus => {
    const active = tasks.filter((task) => task.state === "running");
    const duplicate = active.find((task) => task.key === args.key);

    if (duplicate) {
      throw new Error(`Already running: ${duplicate.label}`);
    }

    const conflict = active.find((task) =>
      CONFLICTS[args.kind].includes(task.kind),
    );

    if (conflict) {
      throw new Error(`Wait for "${conflict.label}" to finish first`);
    }

    const task: TaskStatus = {
      id: nextId,
      kind: args.kind,
      key: args.key,
      label: args.label,
      state: "running",
      message: "Starting",
      error: null,
      round: null,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    nextId++;
    tasks.unshift(task);

    const report = (update: TaskReport): void => {
      task.message = update.message;

      if (update.round) {
        task.round = update.round;
      }
    };

    const settled = args.run(report).then(
      (message) => {
        task.state = "done";
        task.message = message;
      },
      (error: unknown) => {
        task.state = "failed";
        task.error = error instanceof Error ? error.message : String(error);
      },
    );

    running.set(
      task.id,
      settled.finally(() => {
        task.finished_at = new Date().toISOString();
        running.delete(task.id);
        tasks.splice(HISTORY_LIMIT);
      }),
    );

    return task;
  };

  return {
    list: (): TaskStatus[] => tasks,
    start,
    idle: async (): Promise<void> => {
      while (running.size > 0) {
        await Promise.all(running.values());
      }
    },
  };
}
