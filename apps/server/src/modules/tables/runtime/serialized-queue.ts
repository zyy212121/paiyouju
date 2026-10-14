export class SerializedQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(command: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(command);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  whenIdle(): Promise<void> {
    return this.tail;
  }
}
