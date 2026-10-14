export class PokerCoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCardError extends PokerCoreError {}

export class InvalidHandError extends PokerCoreError {}

export class InvalidRandomSourceError extends PokerCoreError {}
