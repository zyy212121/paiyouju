import { createStandardDeck, parseCard, serializeCard, type Card, type PokerVariant } from "@paiyouju/poker-core";

import type { Clock, ScheduledTask, Scheduler } from "./clock.js";
import type { DeckProvider } from "./deck-provider.js";

interface PendingTask {
  readonly at: number;
  cancelled: boolean;
  readonly order: number;
  readonly task: () => void | Promise<void>;
}

export class FakeClockScheduler implements Clock, Scheduler {
  private currentTime: number;
  private nextOrder = 0;
  private readonly tasks: PendingTask[] = [];

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.currentTime = start.getTime();
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  schedule(at: Date, task: () => void | Promise<void>): ScheduledTask {
    const pending: PendingTask = { at: at.getTime(), cancelled: false, order: this.nextOrder++, task };
    this.tasks.push(pending);
    return { cancel: () => { pending.cancelled = true; } };
  }

  async advanceBy(milliseconds: number): Promise<void> {
    const target = this.currentTime + milliseconds;
    while (true) {
      const next = this.tasks
        .filter((task) => !task.cancelled && task.at <= target)
        .sort((left, right) => left.at - right.at || left.order - right.order)[0];
      if (!next) break;
      next.cancelled = true;
      this.currentTime = next.at;
      await next.task();
    }
    this.currentTime = target;
  }
}

export class FixedDeckProvider implements DeckProvider {
  constructor(private readonly cards: readonly Card[]) {}
  nextDeck(variant: PokerVariant = "STANDARD"): readonly Card[] {
    return this.cards
      .filter((card) => variant !== "SHORT_DECK" || card.rank >= 6)
      .map((card) => ({ ...card }));
  }
}

export function createStep65AcceptanceDeck(): readonly Card[] {
  const preferred = ["Kc", "Ac", "Kd", "Qc", "2c", "7d", "9h", "2d", "Kh"].map(parseCard);
  const used = new Set(preferred.map(serializeCard));
  return [...preferred, ...createStandardDeck().filter((card) => !used.has(serializeCard(card)))];
}
