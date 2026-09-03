import { getAgentDir, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";

export function projectIsTrusted(cwd: string, agentDir = getAgentDir()): boolean {
  const trustDecision = new ProjectTrustStore(agentDir).get(cwd);
  if (trustDecision !== null) return trustDecision;

  const globalSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  return globalSettings.getDefaultProjectTrust() === "always";
}
