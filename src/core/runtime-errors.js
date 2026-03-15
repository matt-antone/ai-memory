import { ZodError } from "zod";

export class MemoryRuntimeError extends Error {
  constructor({ category, code, message, status = 500, details = {} }) {
    super(message);
    this.name = "MemoryRuntimeError";
    this.category = category;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function authError(message, details = {}) {
  return new MemoryRuntimeError({
    category: "auth_error",
    code: "auth_failed",
    message,
    status: 401,
    details
  });
}

export function validationError(message, details = {}) {
  return new MemoryRuntimeError({
    category: "validation_error",
    code: "invalid_request",
    message,
    status: 400,
    details
  });
}

export function upstreamError(message, details = {}) {
  return new MemoryRuntimeError({
    category: "upstream_error",
    code: "upstream_failure",
    message,
    status: 502,
    details
  });
}

export function internalError(message, details = {}) {
  return new MemoryRuntimeError({
    category: "internal_error",
    code: "internal_failure",
    message,
    status: 500,
    details
  });
}

export function normalizeError(error, requestId) {
  if (error instanceof MemoryRuntimeError) {
    return withRequestId(error, requestId);
  }

  if (error instanceof ZodError) {
    return withRequestId(validationError("Request validation failed", {
      issues: error.issues
    }), requestId);
  }

  if (error instanceof Error) {
    if (/required|must be|too large|too many|not found/i.test(error.message)) {
      return withRequestId(validationError(error.message), requestId);
    }

    return withRequestId(internalError(error.message), requestId);
  }

  return withRequestId(internalError("Unexpected runtime failure"), requestId);
}

export function errorPayload(error) {
  return {
    ok: false,
    error: {
      category: error.category,
      code: error.code,
      message: error.message,
      request_id: error.details?.request_id ?? null,
      details: error.details?.issues ? { issues: error.details.issues } : {}
    }
  };
}

function withRequestId(error, requestId) {
  if (!requestId) {
    return error;
  }

  return new MemoryRuntimeError({
    category: error.category,
    code: error.code,
    message: error.message,
    status: error.status,
    details: {
      ...error.details,
      request_id: requestId
    }
  });
}
