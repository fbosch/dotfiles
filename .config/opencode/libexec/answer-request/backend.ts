import type { Result } from "neverthrow";
import type { AttachmentValidationError, VerifiedAttachment } from "./attachment.js";
import type { AnswerErrorCode } from "./protocol.js";

export interface AnswerBackendRequest {
  prompt: string;
  timeoutSeconds: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  loadAttachments: () => Promise<Result<VerifiedAttachment[], AttachmentValidationError>>;
}

export type AnswerBackendResult =
  | { ok: true; parts: unknown }
  | { ok: false; code: AnswerErrorCode };

export interface AnswerBackend {
  execute(request: AnswerBackendRequest): Promise<AnswerBackendResult>;
}
