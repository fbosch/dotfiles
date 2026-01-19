import { exec } from "child_process";
import { promisify } from "util";
import { environment } from "@vicinae/api";
import type { ScanResult, ScanSummary } from "./types";

const execAsync = promisify(exec);

// Helper to get home directory with fallback
function getHomeDir(): string {
  return environment.HOME || process.env.HOME || "/tmp";
}

/**
 * Check if ClamAV is installed on the system
 */
export async function checkClamAVInstalled(): Promise<boolean> {
  try {
    await execAsync("which clamscan");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get ClamAV version
 */
export async function getClamAVVersion(): Promise<string> {
  try {
    const { stdout } = await execAsync("clamscan --version");
    return stdout.trim();
  } catch (error) {
    throw new Error(
      `Failed to get ClamAV version: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function checkDatabaseStatus(): Promise<{
  exists: boolean;
  age?: string;
  path?: string;
}> {
  try {
    // Check in user's home directory first (where we download it)
    const homeDbPath = `${getHomeDir()}/.clamav`;
    
    // Try to run a simple clamscan test to see if database is accessible
    const { stdout, stderr } = await execAsync(
      `clamscan --database="${homeDbPath}" --version 2>&1 || echo 'db_not_found'`,
      { timeout: 5000 }
    );
    
    const output = stdout + stderr;
    
    // If we can't load the database, it doesn't exist or isn't accessible
    if (
      output.includes("db_not_found") ||
      output.includes("No such file or directory") ||
      output.includes("Can't get file status") ||
      output.includes("cl_load()") ||
      output.includes("Can't open")
    ) {
      return { exists: false, age: "not found", path: homeDbPath };
    }
    
    return { exists: true, age: "available", path: homeDbPath };
  } catch {
    return { exists: false, age: "unknown", path: `${getHomeDir()}/.clamav` };
  }
}

/**
 * Parse clamscan output to extract scan results
 */
function parseScanOutput(output: string, targetPath: string): {
  results: ScanResult[];
  summary: Partial<ScanSummary>;
} {
  const lines = output.split("\n");
  const results: ScanResult[] = [];
  const summary: Partial<ScanSummary> = {
    totalFiles: 0,
    infectedFiles: 0,
    cleanFiles: 0,
    errors: 0,
    scannedDirectories: 0,
  };

  for (const line of lines) {
    // Parse infected files: /path/to/file: Virus.Name FOUND
    if (line.includes(" FOUND")) {
      const match = line.match(/^(.+?):\s+(.+?)\s+FOUND$/);
      if (match) {
        results.push({
          path: match[1].trim(),
          status: "infected",
          virus: match[2].trim(),
        });
      }
    }
    // Parse summary statistics
    else if (line.includes("Infected files:")) {
      const match = line.match(/Infected files:\s+(\d+)/);
      if (match) summary.infectedFiles = parseInt(match[1], 10);
    } else if (line.includes("Scanned files:")) {
      const match = line.match(/Scanned files:\s+(\d+)/);
      if (match) summary.totalFiles = parseInt(match[1], 10);
    } else if (line.includes("Scanned directories:")) {
      const match = line.match(/Scanned directories:\s+(\d+)/);
      if (match) summary.scannedDirectories = parseInt(match[1], 10);
    }
  }

  // Calculate clean files
  summary.cleanFiles = (summary.totalFiles || 0) - (summary.infectedFiles || 0);

  // If no infected files found, add a clean result for the target
  if (results.length === 0 && summary.totalFiles && summary.totalFiles > 0) {
    results.push({
      path: targetPath,
      status: "clean",
    });
  }

  return { results, summary };
}

function buildScanCommand(
  targetPath: string,
  options: {
    recursive?: boolean;
    infectedOnly?: boolean;
    remove?: boolean;
    excludePatterns?: string[];
  },
): string {
  const args: string[] = ["clamscan"];

  // Specify database location (user's home directory)
  const homeDbPath = `${getHomeDir()}/.clamav`;
  args.push(`--database="${homeDbPath}"`);

  // Add flags
  if (options.recursive) args.push("-r");
  if (options.infectedOnly) args.push("-i");
  if (options.remove) args.push("--remove");

  // Exclude patterns
  if (options.excludePatterns && options.excludePatterns.length > 0) {
    for (const pattern of options.excludePatterns) {
      args.push(`--exclude="${pattern}"`);
    }
  }

  // Add verbose output for better parsing
  args.push("-v");

  // Add target path (quoted for safety)
  args.push(`"${targetPath}"`);

  return args.join(" ");
}

/**
 * Scan a directory or file with ClamAV
 */
export async function scanPath(
  targetPath: string,
  options: {
    recursive?: boolean;
    infectedOnly?: boolean;
    remove?: boolean;
    excludePatterns?: string[];
    onProgress?: (currentFile: string) => void;
  } = {},
): Promise<{
  results: ScanResult[];
  summary: ScanSummary;
  rawOutput: string;
}> {
  const startTime = new Date();

  try {
    const command = buildScanCommand(targetPath, options);

    // Execute scan
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large scans
    });

    const output = stdout + stderr;
    const { results, summary: partialSummary } = parseScanOutput(
      output,
      targetPath,
    );

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    const summary: ScanSummary = {
      totalFiles: partialSummary.totalFiles || 0,
      infectedFiles: partialSummary.infectedFiles || 0,
      cleanFiles: partialSummary.cleanFiles || 0,
      errors: partialSummary.errors || 0,
      scannedDirectories: partialSummary.scannedDirectories || 0,
      startTime,
      endTime,
      duration: `${duration}s`,
    };

    return { results, summary, rawOutput: output };
  } catch (error) {
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    // ClamAV exits with code 1 when viruses are found
    // We need to check if it's an actual error or just infected files
    if (error instanceof Error && "stdout" in error && "stderr" in error) {
      const output = (error as any).stdout + (error as any).stderr;
      const { results, summary: partialSummary } = parseScanOutput(
        output,
        targetPath,
      );

      // If we found infected files, it's not an error
      if (results.length > 0 && results.some((r) => r.status === "infected")) {
        const summary: ScanSummary = {
          totalFiles: partialSummary.totalFiles || 0,
          infectedFiles: partialSummary.infectedFiles || 0,
          cleanFiles: partialSummary.cleanFiles || 0,
          errors: partialSummary.errors || 0,
          scannedDirectories: partialSummary.scannedDirectories || 0,
          startTime,
          endTime,
          duration: `${duration}s`,
        };

        return { results, summary, rawOutput: output };
      }
    }

    // Real error occurred
    throw new Error(
      `Scan failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
