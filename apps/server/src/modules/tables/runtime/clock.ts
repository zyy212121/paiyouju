export interface Clock {
  now(): Date;
}

export interface ScheduledTask {
  cancel(): void;
}

export interface Scheduler {
  schedule(at: Date, task: () => void | Promise<void>): ScheduledTask;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export const systemScheduler: Scheduler = {
  schedule(at, task) {
    let cancelled = false;
    const delay = Math.max(0, at.getTime() - Date.now());
    const timer = setTimeout(() => {
      if (!cancelled) void task();
    }, delay);
    return {
      cancel() {
        cancelled = true;
        clearTimeout(timer);
      },
    };
  },
};
