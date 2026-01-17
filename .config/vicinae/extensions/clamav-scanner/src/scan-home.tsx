import {
  closeMainWindow,
  getPreferenceValues,
  showHUD,
  showToast,
  Toast,
} from "@vicinae/api";
import {
  checkClamAVInstalled,
  checkDatabaseStatus,
  scanPath,
} from "./scanner";

type Preferences = {
  recursiveScan: boolean;
  showInfectedOnly: boolean;
  removeInfected: boolean;
  excludePatterns: string;
};

// Helper to get home directory with fallback
function getHomeDir(): string {
  return process.env.HOME || "/tmp";
}

export default async function ScanHome() {
  const prefs = getPreferenceValues<Preferences>();

  try {
    // Check if ClamAV is installed
    const installed = await checkClamAVInstalled();
    if (!installed) {
      await showToast({
        style: Toast.Style.Failure,
        title: "ClamAV Not Installed",
        message: "Install with: nix-env -iA nixpkgs.clamav",
      });
      return;
    }

    // Check database
    const dbStatus = await checkDatabaseStatus();
    if (!dbStatus.exists) {
      await showToast({
        style: Toast.Style.Warning,
        title: "Virus Database Missing",
        message: "Run 'freshclam' to download definitions",
      });
      return;
    }

    await showToast({
      style: Toast.Style.Animated,
      title: "Scanning Home Directory...",
      message: "This may take a while",
    });

    const excludePatterns = prefs.excludePatterns
      ? prefs.excludePatterns.split(",").map((p) => p.trim())
      : [];

    const homeDir = getHomeDir();
    const scanResult = await scanPath(homeDir, {
      recursive: true,
      infectedOnly: true,
      remove: prefs.removeInfected,
      excludePatterns,
    });

    await closeMainWindow();

    if (scanResult.summary.infectedFiles > 0) {
      await showHUD(
        `⚠️ THREATS FOUND!\n${scanResult.summary.infectedFiles} infected file(s)\nScanned ${scanResult.summary.totalFiles} files in ${scanResult.summary.duration}`,
      );
    } else {
      await showHUD(
        `✓ No threats found\nScanned ${scanResult.summary.totalFiles} files in ${scanResult.summary.duration}`,
      );
    }
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Scan Failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
