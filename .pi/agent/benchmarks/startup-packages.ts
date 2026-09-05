import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const [cwd, agentDir] = process.argv.slice(2);
if (!cwd || !agentDir) throw new Error("Expected project and agent directories");

// Offline resolution silently skips unavailable packages before consulting onMissing.
// This separate preflight only resolves resources; its callback forbids installation.
if (process.env.PI_OFFLINE !== "0") {
  throw new Error("Package preflight requires PI_OFFLINE=0 and forbids installation");
}
const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
const errors = settingsManager.drainErrors();
if (errors.length > 0) throw new AggregateError(errors.map(({ error }) => error));

const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager });
await packages.resolve(async () => "error");
