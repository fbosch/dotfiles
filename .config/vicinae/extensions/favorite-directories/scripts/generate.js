#!/usr/bin/env node

/**
 * Generates command files and updates package.json based on directories config
 * Run with: npm run generate
 */

const fs = require('fs');
const path = require('path');

// Configuration - edit this to add/remove directories
// Icons use freedesktop icon names that Vicinae will resolve from the selected icon theme
// Common icons: folder-download, folder-documents, folder-pictures, folder-music, folder-videos, etc.
const DIRECTORIES = [
  { name: "downloads", title: "Downloads", path: "~/Downloads", icon: "folder-download" },
  { name: "documents", title: "Documents", path: "~/Documents", icon: "folder-documents" },
  { name: "pictures", title: "Pictures", path: "~/Pictures", icon: "folder-pictures" },
  { name: "desktop", title: "Desktop", path: "~/Desktop", icon: "user-desktop" },
  { name: "dotfiles", title: "Dotfiles", path: "~/dotfiles", icon: "folder-git" },
  // Add more directories here:
  // { name: "projects", title: "Projects", path: "~/Projects", icon: "folder-development" },
  // { name: "config", title: "Config", path: "~/.config", icon: "folder-root" },
  // { name: "music", title: "Music", path: "~/Music", icon: "folder-music" },
  // { name: "videos", title: "Videos", path: "~/Videos", icon: "folder-videos" },
];

const SRC_DIR = path.join(__dirname, '..', 'src');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

// Template for command files
function getCommandTemplate(dirPath) {
  return `import { openDirectory } from "./utils";

export default async function Command() {
  await openDirectory("${dirPath}");
}
`;
}

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
console.log('\n📦 Updating package.json...\n');
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

packageJson.commands = DIRECTORIES.map(({ name, title, path: dirPath, icon }) => ({
  name: `open-${name}`,
  title: title,
  subtitle: `Open ${title} folder`,
  description: `Open ${dirPath} in file manager`,
  mode: "no-view",
  icon: icon
}));

fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + '\n');
console.log('   ✓ Updated commands');

console.log('\n✨ Done! Run "npm run build" to rebuild the extension.\n');


