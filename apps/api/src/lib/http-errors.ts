export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, "bad_request", message, details);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(404, "not_found", message, details);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, "conflict", message, details);
    this.name = "ConflictError";
  }
}

export class BadGatewayError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(502, "bad_gateway", message, details);
    this.name = "BadGatewayError";
  }
}

export class GatewayTimeoutError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(504, "gateway_timeout", message, details);
    this.name = "GatewayTimeoutError";
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
