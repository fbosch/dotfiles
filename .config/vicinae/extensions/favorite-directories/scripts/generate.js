#!/usr/bin/env node

/**
 * Generates command files and updates package.json based on directories config
 * Run with: npm run generate
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configuration - edit this to add/remove directories
// Icons use freedesktop icon names that Vicinae will resolve from the selected icon theme
// Common icons: folder-download, folder-documents, folder-pictures, folder-music, folder-videos,
//               folder-git, folder-development, folder-root, user-desktop, user-home, etc.
// Find more at: https://specifications.freedesktop.org/icon-naming-spec/latest/ar01s04.html
const DIRECTORIES = [
  // Local directories
  {
    name: "downloads", // Unique identifier (used in filename)
    title: "Downloads", // Display name in Vicinae
    path: "~/Downloads", // Path to directory (supports ~ expansion)
    icon: "folder-download", // Freedesktop icon name
  },
  {
    name: "pictures",
    title: "Pictures",
    path: "~/Pictures",
    icon: "folder-pictures",
  },
  {
    name: "desktop",
    title: "Desktop",
    path: "~/Desktop",
    icon: "user-desktop",
  },
  {
    name: "dotfiles",
    title: "Dotfiles",
    path: "~/dotfiles",
    icon: "folder-git",
  },
  
  // NAS directories (denoted with mounted emblem)
  {
    name: "nas-documents",
    title: "Documents (NAS)",
    path: "/mnt/nas/FrederikDocs",
    icon: "folder-cloud-documents",
  },
  {
    name: "nas-downloads",
    title: "Downloads (NAS)",
    path: "/mnt/nas/downloads",
    icon: "folder-cloud-download",
  },
  {
    name: "nas-music",
    title: "Music (NAS)",
    path: "/mnt/nas/music",
    icon: "folder-cloud-music",
  },
  {
    name: "nas-photos",
    title: "Photos (NAS)",
    path: "/mnt/nas/photo",
    icon: "folder-cloud-photos",
  },
  {
    name: "nas-videos",
    title: "Videos (NAS)",
    path: "/mnt/nas/video",
    icon: "folder-cloud-videos",
  },
  {
    name: "nas-encrypted",
    title: "Encrypted (NAS)",
    path: "/mnt/nas/encrypted",
    icon: "folder-cloud-encrypted",
  },
  
  // External drives
  {
    name: "lacie",
    title: "LaCie",
    path: "/mnt/LaCie",
    icon: "folder-cloud-lacie",
  },
];

const SRC_DIR = path.join(__dirname, "..", "src");
const ASSETS_DIR = path.join(__dirname, "..", "assets");
const PACKAGE_JSON = path.join(__dirname, "..", "package.json");
const ICON_THEME_PATH = path.join(
  process.env.HOME,
  ".local/share/icons/Win11/places/scalable"
);
const ICON_THEME_EMBLEMS_PATH = path.join(
  process.env.HOME,
  ".local/share/icons/Win11/emblems/24"
);

// Template for command files
function getCommandTemplate(dirPath) {
  return `import { openDirectory } from "./utils";

export default async function Command() {
  await openDirectory("${dirPath}");
}
`;
}

// Icon mapping: extension icon name -> theme icon name
const ICON_MAP = {
  "folder-download": "folder-download.svg",
  "folder-documents": "folder-documents.svg",
  "folder-pictures": "folder-images.svg",
  "folder-photos": "folder-images.svg",
  "folder-music": "folder-music.svg",
  "folder-videos": "folder-videos.svg",
  "folder-git": "folder-git.svg",
  "folder-encrypted": "folder-encrypted.svg",
  "folder-lacie": "folder-cloud.svg",
  "user-desktop": "user-desktop.svg",
};

// Generate PNG icon from SVG
function generateIcon(iconName, outputName, addCloudBadge = false) {
  const iconPath = path.join(ICON_THEME_PATH, iconName);
  const outputPath = path.join(ASSETS_DIR, outputName);

  if (!fs.existsSync(iconPath)) {
    console.warn(`   ⚠ Warning: Icon not found: ${iconPath}`);
    return false;
  }

  try {
    if (addCloudBadge) {
      // Generate with mounted emblem badge overlay
      const badgePath = path.join(ICON_THEME_EMBLEMS_PATH, "emblem-mounted.svg");
      const tmpBase = `/tmp/${Date.now()}-base.png`;
      const tmpBadge = `/tmp/${Date.now()}-badge.png`;

      execSync(
        `convert -background none -resize 256x256 "${iconPath}" "${tmpBase}"`,
        { stdio: "pipe" }
      );
      execSync(
        `convert -background none -resize 80x80 "${badgePath}" "${tmpBadge}"`,
        { stdio: "pipe" }
      );
      execSync(
        `convert "${tmpBase}" "${tmpBadge}" -gravity SouthEast -geometry +5+5 -composite "${outputPath}"`,
        { stdio: "pipe" }
      );

      fs.unlinkSync(tmpBase);
      fs.unlinkSync(tmpBadge);
    } else {
      // Simple conversion
      execSync(
        `convert -background none -resize 256x256 "${iconPath}" "${outputPath}"`,
        { stdio: "pipe" }
      );
    }
    return true;
  } catch (error) {
    console.warn(`   ⚠ Warning: Failed to generate ${outputName}: ${error.message}`);
    return false;
  }
}

// Generate icons
console.log(`\n🎨 Generating icons...\n`);
const iconsToGenerate = new Set();
DIRECTORIES.forEach(({ icon }) => {
  iconsToGenerate.add(icon);
});

iconsToGenerate.forEach((iconName) => {
  const isCloudIcon = iconName.startsWith("folder-cloud-");
  const outputName = `${iconName}.png`;

  if (isCloudIcon) {
    // Extract base icon name (e.g., "folder-cloud-documents" -> "folder-documents")
    const baseIconName = iconName.replace("folder-cloud-", "folder-");
    const themeIcon = ICON_MAP[baseIconName] || `${baseIconName}.svg`;
    
    if (generateIcon(themeIcon, outputName, true)) {
      console.log(`   ✓ ${outputName} (with cloud badge)`);
    }
  } else {
    const themeIcon = ICON_MAP[iconName] || `${iconName}.svg`;
    
    if (generateIcon(themeIcon, outputName, false)) {
      console.log(`   ✓ ${outputName}`);
    }
  }
});

// Generate command files
console.log(`\n📝 Generating ${DIRECTORIES.length} command files...\n`);
DIRECTORIES.forEach(({ name, path: dirPath }) => {
  const filename = `open-${name}.ts`;
  const filepath = path.join(SRC_DIR, filename);
  const content = getCommandTemplate(dirPath);

  fs.writeFileSync(filepath, content);
  console.log(`   ✓ ${filename}`);
});

// Update package.json commands
console.log("\n📦 Updating package.json...\n");
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));

packageJson.commands = DIRECTORIES.map(
  ({ name, title, path: dirPath, icon }) => ({
    name: `open-${name}`,
    title: title,
    subtitle: `Open ${title} folder`,
    description: `Open ${dirPath} in file manager`,
    mode: "no-view",
    icon: `${icon}.png`, // Use PNG files from assets/
  }),
);

fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + "\n");
console.log("   ✓ Updated commands");

console.log('\n✨ Done! Run "npm run build" to rebuild the extension.\n');
