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
  const barWidth = 338;
  const barHeight = 12;
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
      
      <!-- Simple Progress Bar -->
      <rect x="${x}" y="${y + 32}" width="${barWidth}" height="${barHeight}" 
            rx="6" fill="${colors.progressBackground}"/>
      <rect x="${x}" y="${y + 32}" width="${fillWidth}" height="${barHeight}" 
            rx="6" fill="${usageColor}">
        <animate attributeName="width" from="0" to="${fillWidth}" 
                 dur="0.8s" fill="freeze"/>
      </rect>
    `;
    
    return { svg, height: 58 };
  }
  
  // macOS-style categorized storage
  const sortedCategories = [...storage.categories].sort((a, b) => b.bytes - a.bytes);
  let currentX = x;
  const clipPathId = `clip-${Math.random().toString(36).substr(2, 9)}`;
  
  // Generate stacked bar segments (without border radius on individual segments)
  const barSegments = sortedCategories.map((category) => {
    const percent = (category.bytes / storage.total) * 100;
    const segmentWidth = (barWidth * percent) / 100;
    const svg = `
      <rect x="${currentX}" y="${y + 32}" width="${segmentWidth}" height="${barHeight}" 
            fill="${category.color}"/>
    `;
    currentX += segmentWidth;
    return svg;
  }).join("");
  
  // Generate legend items horizontally (macOS-style with name on top, size below)
  const legendStartY = y + 58;
  const squareSize = 10;
  const itemSpacing = 20; // Space between legend items
  const maxWidth = barWidth;
  let currentRow = 0;
  let legendX = x;
  
  const legendItems: string[] = [];
  
  sortedCategories.forEach((category, index) => {
    // Estimate item width (square + gap + text, using longer of name or size)
    const nameLength = category.name.length;
    const sizeLength = formatBytes(category.bytes).length;
    const maxTextLength = Math.max(nameLength, sizeLength);
    const estimatedWidth = squareSize + 8 + (maxTextLength * 7); // ~7px per char
    
    // Check if we need to wrap to next row
    if (legendX + estimatedWidth > x + maxWidth && index > 0) {
      currentRow++;
      legendX = x;
    }
    
    const legendY = legendStartY + (currentRow * 34); // 34px per row (accounts for 2 lines)
    
    legendItems.push(`
      <!-- Category Color Square -->
      <rect x="${legendX}" y="${legendY - 8}" width="${squareSize}" height="${squareSize}" 
            rx="2" fill="${category.color}"/>
      
      <!-- Category Name -->
      <text x="${legendX + squareSize + 8}" y="${legendY}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="12" font-weight="500"
            fill="${colors.textPrimary}"
            text-rendering="geometricPrecision">${escapeXml(category.name)}</text>
      
      <!-- Category Size (on new line) -->
      <text x="${legendX + squareSize + 8}" y="${legendY + 14}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="11" 
            fill="${colors.textTertiary}"
            text-rendering="geometricPrecision">${formatBytes(category.bytes)}</text>
    `);
    
    legendX += estimatedWidth + itemSpacing;
  });
  
  const totalHeight = 72 + (currentRow * 34); // Dynamic height based on legend rows
  
  const svg = `
    <!-- Mount Point (Device Name) -->
    <text x="${x}" y="${y}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="14" font-weight="500" 
          fill="${colors.textPrimary}"
          text-rendering="geometricPrecision">${escapeXml(storage.name.split('/').pop() || storage.mountPoint)}</text>
    
    <!-- Usage Summary (macOS-style) -->
    <text x="${x}" y="${y + 18}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="12" 
          fill="${colors.textTertiary}"
          text-rendering="geometricPrecision">${formatBytes(storage.available)} free of ${formatBytes(storage.total)}</text>
    
    <!-- Clip path for rounded corners -->
    <defs>
      <clipPath id="${clipPathId}">
        <rect x="${x}" y="${y + 32}" width="${barWidth}" height="${barHeight}" rx="6"/>
      </clipPath>
    </defs>
    
    <!-- Stacked Category Bar Background -->
    <rect x="${x}" y="${y + 32}" width="${barWidth}" height="${barHeight}" 
          rx="6" fill="${colors.progressBackground}"/>
    
    <!-- Category Segments (clipped to rounded rectangle) -->
    <g clip-path="url(#${clipPathId})">
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
  const cardWidth = 435;
  const margin = 0;
  const cardSpacing = 12; // Space between cards
  const cardPadding = 20; // Internal card padding
  const progressBarWidth = 338; // Progress bar width
  const percentageXPos = width - 20; // Position percentage text 20px from right edge

  let currentY = 0;

  // Detect distro for logo (Nerd Font icons)
  const osNameLower = info.os.name.toLowerCase();
  const distroLogo = osNameLower.includes('nixos') ? '\uf313' :      // nf-linux-nixos
                     osNameLower.includes('arch') ? '\uf303' :       // nf-linux-archlinux
                     osNameLower.includes('ubuntu') ? '\uf31b' :     // nf-linux-ubuntu
                     osNameLower.includes('debian') ? '\uf306' :     // nf-linux-debian
                     osNameLower.includes('fedora') ? '\uf30a' :     // nf-linux-fedora
                     osNameLower.includes('manjaro') ? '\uf312' :    // nf-linux-manjaro
                     osNameLower.includes('opensuse') ? '\uf314' :   // nf-linux-opensuse
                     osNameLower.includes('gentoo') ? '\uf30d' :     // nf-linux-gentoo
                     osNameLower.includes('redhat') || osNameLower.includes('rhel') ? '\uf316' : // nf-linux-redhat
                     osNameLower.includes('centos') ? '\uf304' :     // nf-linux-centos
                     osNameLower.includes('mint') ? '\uf30e' :       // nf-linux-linuxmint
                     osNameLower.includes('alpine') ? '\uf300' :     // nf-linux-alpine
                     '\uf17c'; // nf-fa-linux (generic tux)
  
  // OS Header Section - left-aligned with logo and details side by side
  const osHeaderHeight = 110;
  const logoX = margin + 20;
  const logoY = currentY + 55;
  const logoSize = 70;
  const textStartX = logoX + logoSize + 20;
  const textStartY = currentY + 28;
  
  const osHeader = `
    <!-- Distro Logo Circle Background -->
    <circle cx="${logoX + logoSize/2}" cy="${logoY}" r="${logoSize/2}" 
            fill="${colors.progressBackground}" 
            stroke="${colors.cardBorder}" stroke-width="2"/>
    
    <!-- Distro Logo -->
    <text x="${logoX + logoSize/2}" y="${logoY + 14}" 
          font-family="JetBrainsMono Nerd Font, monospace" 
          font-size="42" 
          fill="${colors.accent}"
          text-anchor="middle"
          dominant-baseline="middle"
          text-rendering="geometricPrecision">${distroLogo}</text>
    
    <!-- OS Name and Version (larger) -->
    <text x="${textStartX}" y="${textStartY}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="18" font-weight="600" 
          fill="${colors.textPrimary}"
          text-rendering="geometricPrecision">${escapeXml(info.os.name)}</text>
    <text x="${textStartX}" y="${textStartY + 22}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="13" 
          fill="${colors.textSecondary}"
          text-rendering="geometricPrecision">Version ${escapeXml(info.os.version)}</text>
    
    <!-- Uptime -->
    <text x="${textStartX}" y="${textStartY + 44}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="13" 
          fill="${colors.textSecondary}"
          text-rendering="geometricPrecision">Uptime ${formatUptime(info.os.uptime)}</text>
  `;
  currentY += osHeaderHeight + cardSpacing;

  // Memory Card - combined RAM and Swap in a single bar
  const hasSwap = info.swap.total > 0;
  const memoryHeight = 100;
  
  // Calculate combined memory usage
  const totalMemory = info.memory.total + (hasSwap ? info.swap.total : 0);
  const totalUsed = info.memory.used + (hasSwap ? info.swap.used : 0);
  const ramPercent = (info.memory.used / totalMemory) * 100;
  const swapPercent = hasSwap ? (info.swap.used / totalMemory) * 100 : 0;
  const totalPercent = (totalUsed / totalMemory) * 100;
  
  // Generate stacked progress bar
  const ramFillWidth = (progressBarWidth * ramPercent) / 100;
  const swapFillWidth = (progressBarWidth * swapPercent) / 100;
  const ramColor = getUsageColor(info.memory.usagePercent, colors);
  const swapColor = colors.warning; // Use warning color for swap
  
  const combinedProgressBar = `
    <!-- Progress Bar Background -->
    <rect x="${margin + cardPadding}" y="${currentY + 76}" width="${progressBarWidth}" height="7" 
          rx="3" fill="${colors.progressBackground}"/>
    
    <!-- RAM Fill -->
    <rect x="${margin + cardPadding}" y="${currentY + 76}" width="${ramFillWidth}" height="7" 
          rx="3" fill="${ramColor}">
      <animate attributeName="width" from="0" to="${ramFillWidth}" 
               dur="0.8s" fill="freeze"/>
    </rect>
    
    <!-- Swap Fill (stacked after RAM) -->
    ${hasSwap ? `
    <rect x="${margin + cardPadding + ramFillWidth}" y="${currentY + 76}" width="${swapFillWidth}" height="7" 
          rx="3" fill="${swapColor}">
      <animate attributeName="width" from="0" to="${swapFillWidth}" 
               dur="0.8s" fill="freeze"/>
    </rect>
    ` : ''}
    
    <!-- Progress Label -->
    <text x="${percentageXPos}" y="${currentY + 76 + 7 / 2 + 1}" 
          font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
          font-size="13" fill="${ramColor}" 
          text-rendering="geometricPrecision"
          text-anchor="end"
          dominant-baseline="middle">${totalPercent.toFixed(1)}%</text>
  `;

  const memoryTitleText = hasSwap 
    ? `${formatBytes(info.memory.total)} (${formatBytes(info.swap.total)} swap)`
    : formatBytes(info.memory.total);
  
  const memoryDetailsText = hasSwap 
    ? `${formatBytes(info.memory.used)} used (${formatBytes(info.swap.used)} swap), ${formatBytes(info.memory.available)} available`
    : `${formatBytes(info.memory.used)} used, ${formatBytes(info.memory.available)} available`;

  const memoryCard = generateCard(
    margin,
    currentY,
    cardWidth,
    memoryHeight,
    "MEMORY",
    `
      <text x="${margin + cardPadding}" y="${currentY + 46}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="14" font-weight="500" 
            fill="${colors.textPrimary}"
            text-rendering="geometricPrecision">${memoryTitleText}</text>
      <text x="${margin + cardPadding}" y="${currentY + 64}" 
            font-family="SF Pro Text, system-ui, -apple-system, sans-serif" 
            font-size="12" 
            fill="${colors.textTertiary}"
            text-rendering="geometricPrecision">${memoryDetailsText}</text>
      
      ${combinedProgressBar}
    `,
    colors,
  );
  currentY += memoryHeight + cardSpacing;

  // Storage Card(s) - macOS-style with categories
  let storageContentArray: Array<{ svg: string; height: number }> = [];
  let storageContentY = currentY + 46;
  
  for (const storage of info.storage) {
    const item = generateStorageItem(storage, margin + cardPadding, storageContentY, colors);
    storageContentArray.push(item);
    storageContentY += item.height + 20; // Add spacing between storage devices
  }
  
  const storageContent = storageContentArray.map(item => item.svg).join("");
  const storageHeight = 40 + storageContentArray.reduce((sum, item) => sum + item.height + 20, 0);

  const storageCard = generateCard(
    margin,
    currentY,
    cardWidth,
    storageHeight,
    "STORAGE",
    storageContent,
    colors,
  );
  currentY += storageHeight + cardSpacing;

  // Calculate final height
  const height = currentY;

  // Assemble final SVG with transparent background
  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" 
     xmlns="http://www.w3.org/2000/svg">
  
  <!-- OS Header -->
  ${osHeader}
  
  <!-- Cards -->
  ${memoryCard}
  ${storageCard}
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
