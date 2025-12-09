import { showToast, Toast, closeMainWindow } from "@vicinae/api";
import { exec } from "child_process";
import { promisify } from "util";
import { expandPath, isDirectory, detectFileManager } from "./filesystem";

const execAsync = promisify(exec);

/**
 * Opens a directory in the default file manager
 */
export async function openDirectory(path: string): Promise<void> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Opening directory...",
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

    // Detect file manager
    const fileManager = await detectFileManager();
    if (!fileManager) {
      toast.style = Toast.Style.Failure;
      toast.title = "No file manager found";
      toast.message = "Please install nautilus, dolphin, thunar, nemo, or pcmanfm";
      return;
    }

    // Open directory
    await execAsync(`${fileManager} "${expandedPath}"`);
    
    toast.style = Toast.Style.Success;
    toast.title = "Directory opened";
    
    await closeMainWindow();
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to open directory";
    toast.message = error instanceof Error ? error.message : "Unknown error";
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
