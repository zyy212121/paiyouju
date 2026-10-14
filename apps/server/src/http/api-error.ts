export class ApiError extends Error {
  public readonly expose = true;

  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface SuccessEnvelope<T> {
  readonly data: T;
}

export function success<T>(data: T): SuccessEnvelope<T> {
  return { data };
}
