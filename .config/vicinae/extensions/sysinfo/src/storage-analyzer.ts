import pLimit from "p-limit";
import type { StorageCategory } from "./types";
import { execAsync } from "./utils";

// Concurrency limiter for du commands to prevent OOM
const duLimit = pLimit(3);

// Analyze storage by categories using parallel du commands
export async function analyzeStorageCategories(
  mountPoint: string,
  totalUsed: number,
): Promise<StorageCategory[]> {
  // Only analyze the main filesystem (/)
  if (mountPoint !== "/") {
    return [];
  }

  try {
    const homePath = process.env.HOME || "/home";
    const bigPaths = new Set(["/nix/store", homePath]);

    const runDu = async (path: string) => {
      const expandedPath = path.startsWith("~")
        ? path.replace("~", homePath)
        : path;
      const timeoutSeconds = bigPaths.has(expandedPath) ? 60 : 20;
      try {
        const { stdout } = await execAsync(
          `test -d "${expandedPath}" && timeout ${timeoutSeconds} du -s -x -B1 "${expandedPath}" 2>/dev/null | cut -f1 || echo "0"`,
        );
        return Number.parseInt(stdout.trim() || "0", 10);
      } catch {
        return 0;
      }
    };

    const homeTotal = await runDu(homePath);
    let homeKnownBytes = 0;

    // Define categories with their directories and vibrant colors (inspired by macOS)
    const categoryDefs = [
      {
        name: "Apps",
        paths: ["/usr", "/opt", "/var/lib/flatpak", "/var/lib/snapd"],
        color: "#5FA8D3",
      }, // bright blue
      {
        name: "Nix Store",
        paths: ["/nix/store", "/nix/var", "/var/lib/nixos"],
        color: "#6BA3FF",
      }, // cool blue
      {
        name: "Documents",
        paths: ["~/Documents", "~/Desktop"],
        color: "#F9B572",
      }, // bright orange
      { name: "Photos", paths: ["~/Pictures"], color: "#E85D75" }, // bright pink/red
      { name: "Music", paths: ["~/Music"], color: "#C77DBB" }, // bright purple
      { name: "Videos", paths: ["~/Videos"], color: "#8CC265" }, // bright green
      { name: "Downloads", paths: ["~/Downloads"], color: "#62C3D1" }, // bright cyan
      {
        name: "App Data",
        paths: ["~/.local/share", "~/.config"],
        color: "#A0AEC0",
      }, // steel
      {
        name: "Home Cache",
        paths: ["~/.cache"],
        color: "#8FB1C1",
      }, // slate
      {
        name: "Containers",
        paths: ["/var/lib/docker", "/var/lib/containers"],
        color: "#6FA8DC",
      }, // blue
    {
      name: "VM Images",
      paths: ["/var/lib/libvirt/images"],
      color: "#D9B26F",
    }, // sand
      {
        name: "System Cache",
        paths: ["/var/cache"],
        color: "#8FB1C1",
      }, // slate
      {
        name: "System",
        paths: ["/boot", "/var/log", "/tmp"],
        color: "#9B9B9B",
    }, // gray
  ];

    // Run du commands with concurrency limit to prevent memory issues
    const categoryPromises = categoryDefs.map(async (catDef) => {
      // Run du commands with p-limit to control concurrency
        const pathPromises = catDef.paths.map((path) =>
          duLimit(async () => {
            const bytes = await runDu(path);
            const expandedPath = path.startsWith("~")
              ? path.replace("~", homePath)
              : path;
            if (expandedPath.startsWith(homePath)) {
              homeKnownBytes += bytes;
            }
            return bytes;
          }),
        );

      const bytesPerPath = await Promise.all(pathPromises);
      const totalBytes = bytesPerPath.reduce((sum, bytes) => sum + bytes, 0);

      return {
        name: catDef.name,
        bytes: totalBytes,
        color: catDef.color,
      };
    });

    const categories = (await Promise.all(categoryPromises)).filter(
      (cat) => cat.bytes > 0,
    );

    // Add Home (Other) to capture the rest of the home directory
    if (homeTotal > 0) {
      const homeOtherBytes = Math.max(homeTotal - homeKnownBytes, 0);
      if (homeOtherBytes > 0) {
        categories.push({
          name: "Home (Other)",
          bytes: homeOtherBytes,
          color: "#7FC8A9",
        });
      }
    }

    // Calculate "Other" category (space used but not accounted for)
    const accountedBytes = categories.reduce((sum, cat) => sum + cat.bytes, 0);
    const otherBytes = totalUsed - accountedBytes;

    if (otherBytes > 0 && otherBytes > totalUsed * 0.01) {
      // Only show if > 1% of total
      categories.push({
        name: "Other",
        bytes: otherBytes,
        color: "#7C7C7C",
      });
    }

    return categories;
  } catch (error) {
    console.error("Failed to analyze storage categories:", error);
    return [];
  }
}
