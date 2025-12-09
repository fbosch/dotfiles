import { showToast, Toast, closeMainWindow } from "@vicinae/api";
import { exec } from "child_process";
import { promisify } from "util";
import { expandPath, isDirectory, detectFileManager } from "./filesystem";

const execAsync = promisify(exec);

/**
 * Opens a directory in the default file manager
 */
export async function openDirectory(path: string): Promise<void> {
  try {
    const expandedPath = expandPath(path);
    
    // Check if directory exists
    const exists = await isDirectory(expandedPath);
    if (!exists) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Directory not found",
        message: expandedPath,
      });
      return;
    }

    // Detect file manager
    const fileManager = await detectFileManager();
    if (!fileManager) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No file manager found",
        message: "Please install nautilus, dolphin, thunar, nemo, or pcmanfm",
      });
      return;
    }

    // Open directory
    await execAsync(`${fileManager} "${expandedPath}"`);
    await closeMainWindow();
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
  try {
    const expandedPath = expandPath(path);
    
    // Check if directory exists
    const exists = await isDirectory(expandedPath);
    if (!exists) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Directory not found",
        message: expandedPath,
      });
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
        await closeMainWindow();
        return;
      } catch {
        // Try next terminal
        continue;
      }
    }

    await showToast({
      style: Toast.Style.Failure,
      title: "No terminal emulator found",
      message: "Please install foot, kitty, alacritty, or gnome-terminal",
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to open terminal",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
