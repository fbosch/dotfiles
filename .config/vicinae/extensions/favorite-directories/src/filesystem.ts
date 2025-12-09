import { homedir } from "os";
import { promises as fs } from "fs";
import { resolve, join, basename, dirname } from "path";
import type { DirectoryEntry } from "./types";

/**
 * Expands tilde (~) to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return path.replace(/^~/, homedir());
  }
  return path;
}

/**
 * Checks if a path exists and is a directory
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Checks if a directory/file is hidden (starts with .)
 */
export function isHidden(path: string): boolean {
  const name = basename(path);
  return name.startsWith(".") && name !== "." && name !== "..";
}

/**
 * Gets subdirectories of a directory
 */
export async function getSubdirectories(
  dirPath: string,
  showHidden: boolean = false
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const subdirs = entries
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        if (entry.name === "." || entry.name === "..") return false;
        if (!showHidden && entry.name.startsWith(".")) return false;
        return true;
      })
      .map((entry) => join(dirPath, entry.name));

    return subdirs;
  } catch (error) {
    console.error(`Failed to read directory ${dirPath}:`, error);
    return [];
  }
}

/**
 * Converts a path to a DirectoryEntry
 */
export async function pathToDirectoryEntry(
  path: string,
  isSubdirectory: boolean = false,
  parentPath?: string
): Promise<DirectoryEntry> {
  const expandedPath = expandPath(path);
  const absolutePath = resolve(expandedPath);
  const name = basename(absolutePath);
  const exists = await isDirectory(absolutePath);
  const hidden = isHidden(name);

  return {
    id: absolutePath,
    name,
    path,
    absolutePath,
    isSubdirectory,
    parentPath,
    exists,
    isHidden: hidden,
  };
}

/**
 * Parses favorite directories from preferences
 */
export function parseFavoriteDirectories(favoriteDirectories: string): string[] {
  return favoriteDirectories
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

/**
 * Gets all directories including favorites and their subdirectories
 */
export async function getAllDirectories(
  favoriteDirectories: string,
  includeSubdirectories: boolean,
  showHiddenFiles: boolean
): Promise<DirectoryEntry[]> {
  const favorites = parseFavoriteDirectories(favoriteDirectories);
  const allDirectories: DirectoryEntry[] = [];

  for (const favPath of favorites) {
    // Add the favorite directory itself
    const favEntry = await pathToDirectoryEntry(favPath);
    allDirectories.push(favEntry);

    // Add subdirectories if enabled and directory exists
    if (includeSubdirectories && favEntry.exists) {
      const subdirs = await getSubdirectories(
        favEntry.absolutePath,
        showHiddenFiles
      );
      for (const subdir of subdirs) {
        const subdirEntry = await pathToDirectoryEntry(
          subdir,
          true,
          favEntry.absolutePath
        );
        allDirectories.push(subdirEntry);
      }
    }
  }

  return allDirectories;
}

/**
 * Filters directories based on search query
 */
export function filterDirectories(
  directories: DirectoryEntry[],
  searchQuery: string
): DirectoryEntry[] {
  if (!searchQuery.trim()) {
    return directories;
  }

  const query = searchQuery.toLowerCase();
  return directories.filter((dir) => {
    const nameMatch = dir.name.toLowerCase().includes(query);
    const pathMatch = dir.path.toLowerCase().includes(query);
    const absolutePathMatch = dir.absolutePath.toLowerCase().includes(query);
    return nameMatch || pathMatch || absolutePathMatch;
  });
}

/**
 * Detects available file manager
 */
export async function detectFileManager(): Promise<string | null> {
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);
  
  const fileManagers = ["nemo", "nautilus", "dolphin", "thunar", "pcmanfm"];

  for (const fm of fileManagers) {
    try {
      await execAsync(`which ${fm}`);
      return fm;
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * Gets the command to open a directory in file manager
 */
export async function getFileManagerCommand(
  fileManager: string
): Promise<string> {
  if (fileManager === "auto") {
    const detected = await detectFileManager();
    return detected || "xdg-open";
  }
  return fileManager;
}
