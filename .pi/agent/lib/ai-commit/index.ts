import {
  type GeneratedCommit,
  type GenerateOptions,
  type GitContext,
  generateCommit,
} from "./generate";
import { createPiCommitModel } from "./pi-model";

export type { GeneratedCommit, GenerateError, GenerateOptions, GitContext } from "./generate";
export async function generateCommitWithPi(
  cwd: string,
  context: GitContext,
  modelRef: string | null,
  options: GenerateOptions = {},
): Promise<GeneratedCommit> {
  const model = await createPiCommitModel(cwd, modelRef);
  return generateCommit(context, model.complete, options);
}
