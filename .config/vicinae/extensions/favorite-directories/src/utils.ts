import { showToast, Toast, closeMainWindow, getPreferenceValues } from "@vicinae/api";
import { exec } from "child_process";
import { expandPath, detectFileManager } from "./filesystem";

interface Preferences {
  fileManager: string;
}

/**
 * Opens a directory in the default file manager
 */
export async function openDirectory(path: string): Promise<void> {
  try {
    const expandedPath = expandPath(path);
    
    // Get file manager from preferences
    const preferences = getPreferenceValues<Preferences>();
    const preferredFileManager = preferences.fileManager || "auto";
    
    let fileManager: string | null;
    
    if (preferredFileManager === "auto") {
      // Auto-detect file manager (with caching)
      fileManager = await detectFileManager();
      if (!fileManager) {
        await showToast({
          style: Toast.Style.Failure,
          title: "No file manager found",
          message: "Please install nautilus, dolphin, thunar, nemo, or pcmanfm",
        });
        return;
      }
    } else {
      // Use preference directly (no detection needed - fastest!)
      fileManager = preferredFileManager;
    }

    // Close window immediately for faster perceived performance
    await closeMainWindow();

    // Open directory asynchronously (fire and forget)
    // Use --existing-window for nemo to reuse existing instance (much faster)
    const command = fileManager === 'nemo' 
      ? `${fileManager} --existing-window "${expandedPath}"`
      : `${fileManager} "${expandedPath}"`;
    
    exec(command, (error) => {
      if (error) {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to open directory",
          message: error.message,
        });
      }
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to open directory",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Opens a directory in the terminal
 */
export async function openInTerminal(path: string): Promise<void> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Opening terminal...",
  });

  try {
    const expandedPath = expandPath(path);
    
    // Check if directory exists
    const exists = await isDirectory(expandedPath);
    if (!exists) {
      toast.style = Toast.Style.Failure;
      toast.title = "Directory not found";
      toast.message = expandedPath;
      return;
    }

    // Try common terminal emulators
    const terminals = [
      { cmd: "foot", args: "-D" },
      { cmd: "kitty", args: "--directory" },
      { cmd: "alacritty", args: "--working-directory" },
      { cmd: "wezterm", args: "start --cwd" },
      { cmd: "gnome-terminal", args: "--working-directory" },
      { cmd: "konsole", args: "--workdir" },
    ];

    for (const terminal of terminals) {
      try {
        await execAsync(`${terminal.cmd} ${terminal.args} "${expandedPath}"`);
        
        toast.style = Toast.Style.Success;
        toast.title = "Terminal opened";
        
        await closeMainWindow();
        return;
      } catch {
        // Try next terminal
        continue;
      }
    }

    toast.style = Toast.Style.Failure;
    toast.title = "No terminal emulator found";
    toast.message = "Please install foot, kitty, alacritty, or gnome-terminal";
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to open terminal";
    toast.message = error instanceof Error ? error.message : "Unknown error";
  }
}
