import {
  type GeneratedCommit,
  type GenerateOptions,
  type GitContext,
  generateCommit,
} from "./generate";
import { createPiCommitModel } from "./pi-model";

export type { GeneratedCommit, GenerateError, GenerateOptions, GitContext } from "./generate";
export {
  buildCommitPrompt,
  detectWorkItemScope,
  extractWorkItemId,
  parseAndValidateCommit,
} from "./generate";

export interface PiGeneratedCommit extends GeneratedCommit {
  resolvedModelRef: string;
  profile: string;
}

export async function generateCommitWithPi(
  cwd: string,
  context: GitContext,
  modelRef: string | null,
  options: GenerateOptions = {},
): Promise<PiGeneratedCommit> {
  const model = await createPiCommitModel(cwd, modelRef);
  const commit = await generateCommit(context, model.complete, options);
  return {
    ...commit,
    resolvedModelRef: model.modelRef,
    profile: model.profile,
  };
}
