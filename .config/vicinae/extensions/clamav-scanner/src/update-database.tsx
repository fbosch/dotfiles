import {
  closeMainWindow,
  environment,
  showHUD,
  showToast,
  Toast,
} from "@vicinae/api";
import { exec } from "child_process";
import { promisify } from "util";
import { checkClamAVInstalled } from "./scanner";
import { writeFile as writeFileCallback, mkdir as mkdirCallback, existsSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);
const writeFileAsync = promisify(writeFileCallback);
const mkdirAsync = promisify(mkdirCallback);

async function setupClamAVConfig(): Promise<string> {
  console.log("[ClamAV] Starting config setup...");
  
  // Use process.env.HOME as fallback since environment.HOME might not be available
  const homeDir = environment.HOME || process.env.HOME;
  console.log("[ClamAV] environment.HOME:", environment.HOME);
  console.log("[ClamAV] process.env.HOME:", process.env.HOME);
  console.log("[ClamAV] Using homeDir:", homeDir);
  
  if (!homeDir) {
    throw new Error("Could not determine home directory (both environment.HOME and process.env.HOME are undefined)");
  }
  
  const clamavDir = join(homeDir, ".clamav");
  const configPath = join(clamavDir, "freshclam.conf");
  
  console.log("[ClamAV] clamavDir:", clamavDir);
  console.log("[ClamAV] configPath:", configPath);

  // Create directory if it doesn't exist
  if (!existsSync(clamavDir)) {
    console.log("[ClamAV] Directory doesn't exist, creating...");
    await mkdirAsync(clamavDir, { recursive: true });
    console.log("[ClamAV] Directory created successfully");
  } else {
    console.log("[ClamAV] Directory already exists");
  }

  // Always create/update config to ensure absolute paths
  const config = `# Minimal freshclam configuration
DatabaseMirror database.clamav.net
DatabaseDirectory ${clamavDir}
UpdateLogFile ${join(clamavDir, "freshclam.log")}
LogVerbose yes
LogTime yes
`;
  console.log("[ClamAV] Writing config file...");
  console.log("[ClamAV] Config content:", config);
  
  await writeFileAsync(configPath, config, "utf8");
  console.log("[ClamAV] Config file written successfully");

  return configPath;
}

export default async function UpdateDatabase() {
  console.log("[ClamAV] UpdateDatabase command started");
  
  try {
    // Check if ClamAV is installed
    console.log("[ClamAV] Checking if ClamAV is installed...");
    const installed = await checkClamAVInstalled();
    console.log("[ClamAV] ClamAV installed:", installed);
    
    if (!installed) {
      console.log("[ClamAV] ClamAV not found, showing error");
      await showToast({
        style: Toast.Style.Failure,
        title: "ClamAV Not Installed",
        message: "Install with: nix-env -iA nixpkgs.clamav",
      });
      return;
    }

    await showToast({
      style: Toast.Style.Animated,
      title: "Setting up ClamAV...",
      message: "Creating configuration",
    });

    let configPath: string;
    let clamavDir: string;
    
    try {
      console.log("[ClamAV] Setting up config...");
      // Setup config file
      configPath = await setupClamAVConfig();
      
      const homeDir = environment.HOME || process.env.HOME;
      if (!homeDir) {
        throw new Error("Could not determine home directory");
      }
      clamavDir = join(homeDir, ".clamav");
      console.log("[ClamAV] Config setup complete, path:", configPath);
    } catch (setupError) {
      console.error("[ClamAV] Config setup failed:", setupError);
      console.error("[ClamAV] Error stack:", setupError instanceof Error ? setupError.stack : "no stack");
      await showToast({
        style: Toast.Style.Failure,
        title: "Config Creation Failed",
        message: setupError instanceof Error ? setupError.message : "Failed to create config file",
      });
      return;
    }

    await showToast({
      style: Toast.Style.Animated,
      title: "Updating Database...",
      message: "~200MB download",
    });

    // Run freshclam with our config
    console.log("[ClamAV] Running freshclam...");
    const freshclamCmd = `freshclam --config-file="${configPath}"`;
    console.log("[ClamAV] Command:", freshclamCmd);
    
    try {
      const { stdout, stderr } = await execAsync(freshclamCmd, {
        timeout: 600000, // 10 minute timeout for large downloads
      });

      const output = stdout + stderr;
      console.log("[ClamAV] freshclam output length:", output.length);
      console.log("[ClamAV] freshclam output (first 500 chars):", output.substring(0, 500));

      // Check if update was successful
      if (
        output.includes("Database updated") ||
        output.includes("up-to-date") ||
        output.includes("up to date") ||
        output.includes("downloaded")
      ) {
        console.log("[ClamAV] Database update successful");
        await closeMainWindow();
        await showHUD("✓ Database updated");
      } else if (output.includes("ERROR")) {
        console.error("[ClamAV] freshclam returned ERROR");
        throw new Error(output);
      } else {
        console.log("[ClamAV] Database update completed (unknown status)");
        await closeMainWindow();
        await showHUD("✓ Database ready");
      }
    } catch (error) {
      console.error("[ClamAV] freshclam execution failed:", error);
      console.error("[ClamAV] Error details:", error instanceof Error ? error.stack : error);
      
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      if (errorMsg.includes("locked") || errorMsg.includes("is locked by another process")) {
        await showToast({
          style: Toast.Style.Warning,
          title: "Database Locked",
          message: "freshclam already running",
        });
      } else if (errorMsg.includes("Can't connect") || errorMsg.includes("Connection")) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Network Error",
          message: "Can't reach database servers",
        });
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "Update Failed",
          message: errorMsg.substring(0, 80),
        });
      }
    }
  } catch (error) {
    console.error("[ClamAV] Top-level error caught:", error);
    console.error("[ClamAV] Error type:", typeof error);
    console.error("[ClamAV] Error instanceof Error:", error instanceof Error);
    if (error instanceof Error) {
      console.error("[ClamAV] Error name:", error.name);
      console.error("[ClamAV] Error message:", error.message);
      console.error("[ClamAV] Error stack:", error.stack);
    }
    
    await showToast({
      style: Toast.Style.Failure,
      title: "Setup Failed",
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
