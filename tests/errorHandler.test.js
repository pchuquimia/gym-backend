import { jest } from "@jest/globals";
import { errorHandler } from "../src/middleware/errorHandler.js";

test("logs production failures with a request id without disclosing request or error values", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const res = {
    locals: { requestId: "request-123" },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  try {
    const err = new Error(
      "mongodb://password-secret@db.invalid health-private token-private",
    );
    errorHandler(
      err,
      {
        method: "POST",
        route: { path: "/:id" },
        body: { password: "password-secret" },
        headers: { authorization: "token-private" },
        originalUrl: "/somewhere?token=token-private",
      },
      res,
      () => {},
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "request_error",
        requestId: "request-123",
        statusCode: 500,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /password-secret|health-private|token-private/,
    );
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
