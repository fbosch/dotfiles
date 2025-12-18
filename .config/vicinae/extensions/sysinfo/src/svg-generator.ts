import type { SystemInfo } from "./types";

// Zenwritten color palette with light/dark variants
export interface ThemeColors {
  cardBackground: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentLight: string;
  success: string;
  warning: string;
  danger: string;
  purple: string;
  progressBackground: string;
}

const DARK_COLORS: ThemeColors = {
  cardBackground: "#222222",
  cardBorder: "#555555",
  textPrimary: "#BBBBBB",
  textSecondary: "#8E8E8E",
  textTertiary: "#686868",
  accent: "#66A5AD", // cyan
  accentLight: "#6099C0", // blue
  success: "#819B69", // green
  warning: "#B77E64", // orange
  danger: "#DE6E7C", // red
  purple: "#B279A7",
  progressBackground: "#2C2C2C",
};

const LIGHT_COLORS: ThemeColors = {
  cardBackground: "#E5E5E5",
  cardBorder: "#8B8B8B",
  textPrimary: "#353535",
  textSecondary: "#6B6B6B",
  textTertiary: "#8B8B8B",
  accent: "#66A5AD", // cyan
  accentLight: "#6099C0", // blue
  success: "#6B8456", // slightly darker green for light mode
  warning: "#A0654F", // slightly darker orange
  danger: "#C5505E", // slightly darker red
  purple: "#9A6691", // slightly darker purple
  progressBackground: "#D7D7D7",
};

export function getThemeColors(appearance: "light" | "dark"): ThemeColors {
  return appearance === "dark" ? DARK_COLORS : LIGHT_COLORS;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatPackageCount(packages: {
  nix?: number;
  flatpak?: number;
  dpkg?: number;
  rpm?: number;
  pacman?: number;
}): string {
  const counts: string[] = [];

  if (packages.nix) counts.push(`${packages.nix} nix`);
  if (packages.flatpak) counts.push(`${packages.flatpak} flatpak`);
  if (packages.dpkg) counts.push(`${packages.dpkg} dpkg`);
  if (packages.rpm) counts.push(`${packages.rpm} rpm`);
  if (packages.pacman) counts.push(`${packages.pacman} pacman`);

  return counts.join(", ");
}

function getUsageColor(percent: number, colors: ThemeColors): string {
  if (percent < 60) return colors.success;
  if (percent < 80) return colors.warning;
  return colors.danger;
}

// Generate macOS-style storage visualization with categories
function generateStorageItem(
  storage: SystemInfo["storage"][0],
  x: number,
  y: number,
  colors: ThemeColors,
): { svg: string; height: number } {
  const barWidth = 419; // Full width (435 - 8*2 margins)
  const barHeight = 14; // Storage bar height (thicker for better category visibility)
  const legendItemHeight = 18;

  // If no categories, show simple progress bar
  if (!storage.categories || storage.categories.length === 0) {
    const usageColor = getUsageColor(storage.usagePercent, colors);
    const fillWidth = (barWidth * storage.usagePercent) / 100;

    const svg = `
      <!-- Mount Point -->
      <text x="${x}" y="${y}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="14" font-weight="500" 
            fill="${colors.textPrimary}"
            text-rendering="geometricPrecision">${escapeXml(storage.mountPoint)}</text>
      
      <!-- Usage Summary -->
      <text x="${x}" y="${y + 18}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="12" 
            fill="${colors.textTertiary}"
            text-rendering="geometricPrecision">${formatBytes(storage.available)} free of ${formatBytes(storage.total)}</text>
      
      <!-- Usage Percentage -->
      <text x="${x + barWidth}" y="${y + 18}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="12" 
            fill="${storage.usagePercent >= 90 ? colors.danger : colors.textTertiary}"
            text-anchor="end"
            text-rendering="geometricPrecision">${storage.usagePercent.toFixed(1)}%</text>
      
      <!-- Simple Progress Bar -->
      <rect x="${x}" y="${y + 32}" width="${barWidth}" height="${barHeight}" 
            rx="5" fill="${colors.progressBackground}"/>
      <rect x="${x}" y="${y + 32}" width="${fillWidth}" height="${barHeight}" 
            rx="5" fill="${usageColor}">
        <animate attributeName="width" from="0" to="${fillWidth}" 
                 dur="0.8s" fill="freeze"/>
      </rect>
    `;

    return { svg, height: 58 };
  }

  // macOS-style categorized storage
  const sortedCategories = [...storage.categories].sort(
    (a, b) => b.bytes - a.bytes,
  );
  let currentX = x;
  const clipPathId = `clip-${Math.random().toString(36).substr(2, 9)}`;

  // Generate stacked bar segments (without border radius on individual segments)
  const barSegments = sortedCategories
    .map((category) => {
      const percent = (category.bytes / storage.total) * 100;
      const segmentWidth = (barWidth * percent) / 100;
      const svg = `
      <rect x="${currentX}" y="${y + 32}" width="${segmentWidth}" height="${barHeight}" 
            fill="${category.color}"/>
    `;
      currentX += segmentWidth;
      return svg;
    })
    .join("");

  // Generate legend items horizontally (macOS-style with name on top, size below)
  const legendStartY = y + 64; // Increased from 58 to add more space below bar
  const squareSize = 10;
  const itemSpacing = 12; // Space between legend items (reduced from 20)
  const maxWidth = barWidth;
  let currentRow = 0;
  let legendX = x;

  const legendItems: string[] = [];

  sortedCategories.forEach((category, index) => {
    // Estimate item width (square + gap + text, using longer of name or size)
    const nameLength = category.name.length;
    const sizeLength = formatBytes(category.bytes).length;
    const maxTextLength = Math.max(nameLength, sizeLength);
    const estimatedWidth = squareSize + 8 + maxTextLength * 6; // ~6px per char (SF Pro Text 12px)

    // Check if we need to wrap to next row
    if (legendX + estimatedWidth > x + maxWidth && index > 0) {
      currentRow++;
      legendX = x;
    }

    const legendY = legendStartY + currentRow * 34; // 34px per row (accounts for 2 lines)

    legendItems.push(`
      <!-- Category Color Square -->
      <rect x="${legendX}" y="${legendY - 8}" width="${squareSize}" height="${squareSize}" 
            rx="2" fill="${category.color}"/>
      
      <!-- Category Name -->
      <text x="${legendX + squareSize + 5}" y="${legendY}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="12" font-weight="500"
            fill="${colors.textPrimary}"
            text-rendering="geometricPrecision">${escapeXml(category.name)}</text>
      
      <!-- Category Size (on new line) -->
      <text x="${legendX + squareSize + 5}" y="${legendY + 14}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="11" 
            fill="${colors.textTertiary}"
            text-rendering="geometricPrecision">${formatBytes(category.bytes)}</text>
    `);

    legendX += estimatedWidth + itemSpacing;
  });

  const totalHeight = 72 + currentRow * 34; // Dynamic height based on legend rows

  const svg = `
    <!-- Mount Point (Device Name) -->
    <text x="${x}" y="${y}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="14" font-weight="500" 
          fill="${colors.textPrimary}"
          text-rendering="geometricPrecision">${escapeXml(storage.name.split("/").pop() || storage.mountPoint)}</text>
    
    <!-- Usage Summary (macOS-style) -->
    <text x="${x}" y="${y + 18}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="12" 
          fill="${colors.textTertiary}"
          text-rendering="geometricPrecision">${formatBytes(storage.available)} free of ${formatBytes(storage.total)}</text>
    
    <!-- Usage Percentage -->
    <text x="${x + barWidth}" y="${y + 18}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="12" 
          fill="${storage.usagePercent >= 90 ? colors.danger : colors.textTertiary}"
          text-anchor="end"
          text-rendering="geometricPrecision">${storage.usagePercent.toFixed(1)}%</text>
    
    <!-- Mask for rounded corners -->
    <defs>
      <mask id="${clipPathId}">
        <rect x="${x}" y="${y + 32}" width="${barWidth}" height="${barHeight}" 
              rx="5" fill="white"/>
      </mask>
    </defs>
    
    <!-- Stacked Category Bar Background -->
    <rect x="${x}" y="${y + 32}" width="${barWidth}" height="${barHeight}" 
          rx="5" fill="${colors.progressBackground}"/>
    
    <!-- Category Segments (masked to rounded rectangle) -->
    <g mask="url(#${clipPathId})">
      ${barSegments}
    </g>
    
    <!-- Legend -->
    ${legendItems.join("")}
  `;

  return { svg, height: totalHeight };
}

function generateProgressBar(
  x: number,
  y: number,
  width: number,
  height: number,
  percent: number,
  colors: ThemeColors,
  percentageX: number, // Explicit X position for percentage text
): string {
  const fillWidth = (width * percent) / 100;
  const color = getUsageColor(percent, colors);

  return `
    <!-- Progress Bar Background -->
    <rect x="${x}" y="${y}" width="${width}" height="${height}" 
          rx="3" fill="${colors.progressBackground}"/>
    
    <!-- Progress Bar Fill -->
    <rect x="${x}" y="${y}" width="${fillWidth}" height="${height}" 
          rx="3" fill="${color}">
      <animate attributeName="width" from="0" to="${fillWidth}" 
               dur="0.8s" fill="freeze"/>
    </rect>
    
    <!-- Progress Label -->
    <text x="${percentageX}" y="${y + height / 2 + 1}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="13" fill="${color}" 
          text-rendering="geometricPrecision"
          text-anchor="end"
          dominant-baseline="middle">${percent.toFixed(1)}%</text>
  `;
}

function generateCard(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  content: string,
  colors: ThemeColors,
): string {
  return `
    <!-- Card -->
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" 
            rx="8" fill="${colors.cardBackground}" 
            stroke="${colors.cardBorder}" stroke-width="1"/>
      
      <!-- Card Title -->
      <text x="${x + 18}" y="${y + 24}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="11" font-weight="600" 
            fill="${colors.textSecondary}"
            letter-spacing="0.5"
            text-rendering="geometricPrecision">${escapeXml(title)}</text>
      
      <!-- Card Content -->
      ${content}
    </g>
  `;
}

export function generateSystemInfoSVG(
  info: SystemInfo,
  appearance: "light" | "dark" = "dark",
): string {
  const colors = getThemeColors(appearance);

  // Exact available width in Vicinae Detail view (no rescaling)
  const width = 435;
  const sectionMargin = 8; // Small margin without card borders
  const sectionSpacing = 6; // Space between sections (minimized for tighter layout)
  const progressBarWidth = 419; // Full width minus small margins (435 - 8*2)
  const contentWidth = 419; // Available content width
  const memoryBarHeight = 14; // Memory bar height (matches storage bar)
  const storageBarHeight = 14; // Storage bar height

  let currentY = 0;

  // Detect distro for logo (Nerd Font icons)
  const osNameLower = info.os.name.toLowerCase();
  const distroLogo = osNameLower.includes("nixos")
    ? "\uf313" // nf-linux-nixos
    : osNameLower.includes("arch")
      ? "\uf303" // nf-linux-archlinux
      : osNameLower.includes("ubuntu")
        ? "\uf31b" // nf-linux-ubuntu
        : osNameLower.includes("debian")
          ? "\uf306" // nf-linux-debian
          : osNameLower.includes("fedora")
            ? "\uf30a" // nf-linux-fedora
            : osNameLower.includes("manjaro")
              ? "\uf312" // nf-linux-manjaro
              : osNameLower.includes("opensuse")
                ? "\uf314" // nf-linux-opensuse
                : osNameLower.includes("gentoo")
                  ? "\uf30d" // nf-linux-gentoo
                  : osNameLower.includes("redhat") ||
                      osNameLower.includes("rhel")
                    ? "\uf316" // nf-linux-redhat
                    : osNameLower.includes("centos")
                      ? "\uf304" // nf-linux-centos
                      : osNameLower.includes("mint")
                        ? "\uf30e" // nf-linux-linuxmint
                        : osNameLower.includes("alpine")
                          ? "\uf300" // nf-linux-alpine
                          : "\uf17c"; // nf-fa-linux (generic tux)

  // OS Header Section - left-aligned with logo and details side by side
  const osHeaderHeight = 88 + (info.os.packages ? 20 : 0); // Reduced height for compact layout
  const logoX = sectionMargin + 10; // Move logo more to the left
  const logoY = currentY + 55;
  const logoSize = 70;
  const textStartX = logoX + logoSize + 24; // More gap between logo and text (was 16)
  const textStartY = currentY + 32;
  const maxTextWidth = width - textStartX - 16; // Add right margin

  // Parse OS name to extract distro name (e.g., "NixOS 24.11 (Vicuna)" -> "NixOS")
  const distroName = info.os.name.split(" ")[0];
  // Capitalize codename first letter - NO leading space here
  const codename = info.os.codename
    ? `${info.os.codename.charAt(0).toUpperCase() + info.os.codename.slice(1)}`
    : "";
  // Add single trailing space to distro name if there's a codename
  const distroNameWithSpacing = codename ? `${distroName} ` : distroName;

  // Generate unique IDs for gradients and filters
  const logoGradientId = `logoGradient-${Math.random().toString(36).substr(2, 9)}`;
  const logoShadowId = `logoShadow-${Math.random().toString(36).substr(2, 9)}`;
  const iconGradientId = `iconGradient-${Math.random().toString(36).substr(2, 9)}`;

  const osHeader = `
    <!-- Distro Logo Circle with Gradient and Shadow -->
    <defs>
      <radialGradient id="${logoGradientId}" cx="30%" cy="30%">
        <stop offset="0%" style="stop-color:${colors.progressBackground};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${appearance === "dark" ? "#1a1a1a" : "#d0d0d0"};stop-opacity:1" />
      </radialGradient>
      <filter id="${logoShadowId}">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
        <feOffset dx="0" dy="2" result="offsetblur"/>
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.3"/>
        </feComponentTransfer>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <linearGradient id="${iconGradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:${colors.accentLight};stop-opacity:1" />
        <stop offset="50%" style="stop-color:${colors.accent};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${appearance === "dark" ? "#4a7a82" : "#5088a0"};stop-opacity:1" />
      </linearGradient>
    </defs>
    
    <!-- Outer glow ring -->
    <circle cx="${logoX + logoSize / 2}" cy="${logoY}" r="${logoSize / 2 + 2}" 
            fill="none" 
            stroke="${colors.accent}" 
            stroke-width="1"
            opacity="0.2"/>
    
    <!-- Shadow circle -->
    <circle cx="${logoX + logoSize / 2}" cy="${logoY + 3}" r="${logoSize / 2}" 
            fill="${appearance === "dark" ? "#000000" : "#999999"}" 
            opacity="0.15"/>
    
    <!-- Main circle background with gradient -->
    <circle cx="${logoX + logoSize / 2}" cy="${logoY}" r="${logoSize / 2}" 
            fill="url(#${logoGradientId})" 
            stroke="${colors.cardBorder}" 
            stroke-width="2"/>
    
    <!-- Inner highlight ring (top-left shine) -->
    <circle cx="${logoX + logoSize / 2}" cy="${logoY}" r="${logoSize / 2 - 4}" 
            fill="none" 
            stroke="${appearance === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)"}" 
            stroke-width="2"
            stroke-dasharray="0 ${Math.PI * (logoSize - 8) * 0.5} ${Math.PI * (logoSize - 8) * 0.5} 0"/>
    
    <!-- Distro Logo shadow -->
    <text x="${logoX + logoSize / 2}" y="${logoY + 17}" 
          font-family="JetBrainsMono Nerd Font, monospace" 
          font-size="44" 
          fill="${appearance === "dark" ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.2)"}"
          text-anchor="middle"
          dominant-baseline="middle"
          text-rendering="geometricPrecision"
          opacity="0.8"
          style="filter: blur(2px);">${distroLogo}</text>
    
    <!-- Distro Logo with gradient -->
    <text x="${logoX + logoSize / 2}" y="${logoY + 16}" 
          font-family="JetBrainsMono Nerd Font, monospace" 
          font-size="44" 
          fill="url(#${iconGradientId})"
          text-anchor="middle"
          dominant-baseline="middle"
          text-rendering="geometricPrecision">${distroLogo}</text>
    
    <!-- OS Name and Codename -->
    <text x="${textStartX}" y="${textStartY}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="20" 
          fill="${colors.textPrimary}"
          xml:space="preserve"
          text-rendering="geometricPrecision"><tspan font-weight="700">${escapeXml(distroNameWithSpacing)}</tspan>${codename ? `<tspan font-weight="400">${escapeXml(codename)}</tspan>` : ""}</text>
    
    <!-- Version -->
    <text x="${textStartX}" y="${textStartY + 24}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="13" 
          fill="${colors.textSecondary}"
          xml:space="preserve"
          text-rendering="geometricPrecision"><tspan font-weight="700">Version </tspan><tspan font-weight="400">${escapeXml(info.os.version)}</tspan></text>
    
    <!-- Uptime -->
    <text x="${textStartX}" y="${textStartY + 44}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="13" 
          fill="${colors.textSecondary}"
          xml:space="preserve"
          text-rendering="geometricPrecision"><tspan font-weight="700">Uptime </tspan><tspan font-weight="400">${formatUptime(info.os.uptime)}</tspan></text>
    
     <!-- Packages -->
     ${
       info.os.packages
         ? `
     <text x="${textStartX}" y="${textStartY + 64}" 
           font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
           font-size="13" 
           fill="${colors.textSecondary}"
           xml:space="preserve"
           text-rendering="geometricPrecision"><tspan font-weight="700">Packages </tspan><tspan font-weight="400">${formatPackageCount(info.os.packages)}</tspan></text>
     `
         : ""
     }
  `;
  currentY += osHeaderHeight;

  // Horizontal spacer line
  const spacerY = currentY + 6; // 6px padding before the line
  const spacer = `
    <line x1="${sectionMargin}" y1="${spacerY}" x2="${width - sectionMargin}" y2="${spacerY}" 
          stroke="${colors.cardBorder}" 
          stroke-width="1" 
          opacity="0.3"/>
  `;
  currentY = spacerY + 6; // 6px padding after the line (12px total spacing)

  // Memory Section - no card wrapper
  const hasSwap = info.swap.total > 0;
  const memoryHeight = 85;
  
  // Calculate memory usage percentages (RAM only)
  const ramPercent = info.memory.usagePercent;
  const ramFillWidth = (progressBarWidth * ramPercent) / 100;
  const ramColor = getUsageColor(info.memory.usagePercent, colors);
  
  const clipPathMemory = `clip-memory-${Math.random().toString(36).substr(2, 9)}`;
  
  const memoryTitleText = hasSwap
    ? `${formatBytes(info.memory.total)} (${formatBytes(info.swap.total)} swap)`
    : formatBytes(info.memory.total);
  
  const memoryDetailsText = hasSwap && info.swap.used > 0
    ? `${formatBytes(info.memory.used)} used, ${formatBytes(info.memory.available)} available, ${formatBytes(info.swap.used)} swap used`
    : `${formatBytes(info.memory.used)} used, ${formatBytes(info.memory.available)} available`;

  const memorySection = `
    <!-- Memory Section Header -->
    <text x="${sectionMargin}" y="${currentY + 18}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="11" font-weight="600" 
          fill="${colors.textSecondary}"
          letter-spacing="0.5"
          text-rendering="geometricPrecision">MEMORY</text>
    
    <text x="${sectionMargin}" y="${currentY + 38}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="14" font-weight="500" 
          fill="${colors.textPrimary}"
          text-rendering="geometricPrecision">${memoryTitleText}</text>
    <text x="${sectionMargin}" y="${currentY + 56}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="12" 
          fill="${colors.textTertiary}"
          text-rendering="geometricPrecision">${memoryDetailsText}</text>
    <text x="${sectionMargin + progressBarWidth}" y="${currentY + 56}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="12" 
          fill="${ramPercent >= 90 ? colors.danger : colors.textTertiary}"
          text-anchor="end"
          text-rendering="geometricPrecision">${ramPercent.toFixed(1)}%</text>
    
    <!-- Mask for memory bar rounded corners -->
    <defs>
      <mask id="${clipPathMemory}">
        <rect x="${sectionMargin}" y="${currentY + 68}" width="${progressBarWidth}" height="${memoryBarHeight}" 
              rx="5" fill="white"/>
      </mask>
    </defs>
    
    <!-- Progress Bar Background -->
    <rect x="${sectionMargin}" y="${currentY + 68}" width="${progressBarWidth}" height="${memoryBarHeight}" 
          rx="5" fill="${colors.progressBackground}"/>
    
    <!-- Memory bars (masked) -->
    <g mask="url(#${clipPathMemory})">
      <rect x="${sectionMargin}" y="${currentY + 68}" width="${ramFillWidth}" height="${memoryBarHeight}" 
            fill="${ramColor}"/>
    </g>
  `;
  currentY += memoryHeight + sectionSpacing;

  // Storage Section - no card wrapper
  let storageContentArray: Array<{ svg: string; height: number }> = [];

  // Section header
  const storageSectionHeader = `
    <!-- Storage Section Header -->
    <text x="${sectionMargin}" y="${currentY + 18}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="11" font-weight="600" 
          fill="${colors.textSecondary}"
          letter-spacing="0.5"
          text-rendering="geometricPrecision">STORAGE</text>
  `;

  let storageContentY = currentY + 38;

  for (const storage of info.storage) {
    const item = generateStorageItem(
      storage,
      sectionMargin,
      storageContentY,
      colors,
    );
    storageContentArray.push(item);
    storageContentY += item.height + 20; // Add spacing between storage devices
  }

  const storageContent = storageContentArray.map((item) => item.svg).join("");
  const storageHeight =
    38 + storageContentArray.reduce((sum, item) => sum + item.height + 20, 0);
  currentY += storageHeight;

  // Calculate final height
  const height = currentY;

  // Assemble final SVG with transparent background
  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
     xmlns="http://www.w3.org/2000/svg">
  
  <!-- OS Header -->
  ${osHeader}
  
  <!-- Spacer -->
  ${spacer}
  
  <!-- Sections -->
  ${memorySection}
  ${storageSectionHeader}
  ${storageContent}
</svg>
  `.trim();

  return svg;
}

export function svgToDataUri(svg: string): string {
  // Encode SVG for data URI
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml,${encoded}`;
}
