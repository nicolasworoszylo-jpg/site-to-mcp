/**
 * In-process scheduler — node-cron based.
 *
 * Dla deploy: pojedyncza długo-żyjąca instancja Node (np. PM2, Docker, EC2).
 * Dla macOS local dev: w `launchagent.ts` jest helper który generuje plist.
 */

import cron from 'node-cron';
import type { ModuleName } from '../types.js';

export interface ScheduledTask {
  module: ModuleName;
  schedule: string; // cron expression OR human-readable ('daily 09:00', 'weekly sunday')
  run: () => Promise<unknown>;
}

const HUMAN_SCHEDULES: Record<string, string> = {
  'hourly': '0 * * * *',
  'daily 06:00': '0 6 * * *',
  'daily 09:00': '0 9 * * *',
  'daily 12:00': '0 12 * * *',
  'daily 18:00': '0 18 * * *',
  'daily': '0 9 * * *',
  'weekly sunday': '0 10 * * 0',
  'weekly': '0 10 * * 0',
  'monthly': '0 10 1 * *',
};

export function toCronExpression(schedule: string): string {
  return HUMAN_SCHEDULES[schedule] ?? schedule;
}

export class Scheduler {
  private tasks = new Map<ModuleName, cron.ScheduledTask>();
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? (() => {});
  }

  add(task: ScheduledTask): void {
    const expression = toCronExpression(task.schedule);
    if (!cron.validate(expression)) {
      this.log(`[scheduler] invalid cron expression for ${task.module}: ${expression}`);
      return;
    }
    const job = cron.schedule(expression, async () => {
      this.log(`[scheduler] running ${task.module} (${expression})`);
      try {
        await task.run();
      } catch (err) {
        this.log(`[scheduler] ${task.module} failed: ${err}`);
      }
    });
    this.tasks.set(task.module, job);
    this.log(`[scheduler] registered ${task.module} on ${expression}`);
  }

  start(): void {
    for (const job of this.tasks.values()) job.start();
    this.log(`[scheduler] started ${this.tasks.size} tasks`);
  }

  stop(): void {
    for (const job of this.tasks.values()) job.stop();
    this.log(`[scheduler] stopped`);
  }
}
