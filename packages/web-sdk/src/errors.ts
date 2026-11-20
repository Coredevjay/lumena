export class LumenApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(
    message: string,
  options: { status: number; code?: string; requestId?: string; details?: unknown },
  ) {
    super(message);
    this.name = "LumenApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export class LumenTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "LumenTimeoutError";
  }
}