import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ValidationError, PolicyError, StellarError, errorHandler } from "../errors.js";

describe("errors", () => {
  it("initializes ValidationError with defaults", () => {
    const err = new ValidationError("bad request");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("bad request");
    expect(err.name).toBe("ValidationError");
  });

  it("supports custom status code in ValidationError", () => {
    const err = new ValidationError("unauthorized", undefined, 401);
    expect(err.statusCode).toBe(401);
  });

  it("initializes PolicyError with status code", () => {
    const err = new PolicyError("forbidden", 403);
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe("PolicyError");
  });

  it("initializes StellarError with status code", () => {
    const err = new StellarError("stellar node error", 502);
    expect(err.statusCode).toBe(502);
    expect(err.name).toBe("StellarError");
  });
});

describe("errorHandler result codes", () => {
  it("maps Horizon result codes to a typed error envelope", () => {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as unknown as Response;
    const err = Object.assign(new Error("Request failed with status code 400"), {
      response: {
        data: {
          extras: { result_codes: { transaction: "tx_failed", operations: ["op_no_trust"] } },
        },
      },
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "The destination account does not trust the asset.",
      code: "op_no_trust",
      operationIndex: 0,
      hint: "The recipient must add a trustline for the asset before receiving it.",
    });
  });
});
