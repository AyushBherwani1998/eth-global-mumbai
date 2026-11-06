import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error with an HTTP status and a stable `code` the app can switch on. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", message, details);
export const notFound = (code: string, message: string) => new HttpError(404, code, message);
/** The request is fine but the chain isn't there yet (e.g. no auction before `make launch`). */
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
