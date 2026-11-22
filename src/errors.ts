export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "error"
  ) {
    super(message);
  }
}

export const notFound = (what: string): AppError => new AppError(404, `${what} not found`, "not_found");
export const forbidden = (msg: string): AppError => new AppError(403, msg, "forbidden");
export const badRequest = (msg: string): AppError => new AppError(400, msg, "bad_request");
export const conflict = (msg: string): AppError => new AppError(409, msg, "conflict");
