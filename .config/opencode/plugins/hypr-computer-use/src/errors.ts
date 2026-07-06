export const ERROR = {
  unavailableState: "unavailable-state",
  noActiveTarget: "no-active-target",
  ambiguousTarget: "ambiguous-target",
  missingBackend: "missing-backend",
  noInputBackend: "no-input-backend",
  regionRequired: "region-required",
  rejectedSideEffect: "rejected-side-effect",
  textInputUnsupported: "text-input-unsupported",
  unsupportedKey: "unsupported-key",
  approvalRequired: "approval-required",
  targetDrift: "target-drift",
  controlsCacheInvalid: "controls-cache-invalid",
  unsupportedScope: "unsupported-scope",
  fullCaptureNotAllowed: "full-capture-not-allowed",
} as const

export type ErrorCode = (typeof ERROR)[keyof typeof ERROR]

export class HyprComputerUseError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "HyprComputerUseError"
  }
}

export function errorResult(error: unknown) {
  if (error instanceof HyprComputerUseError) {
    return {
      ok: false as const,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }
  }

  return {
    ok: false as const,
    error: {
      code: "unexpected-error",
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}
