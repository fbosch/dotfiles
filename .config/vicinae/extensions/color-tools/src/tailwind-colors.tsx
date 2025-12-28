import {
  Action,
  ActionPanel,
  Color,
  Grid,
  Icon,
  showToast,
  Toast,
} from "@vicinae/api";
import { useMemo, useState } from "react";
import type { ColorEntry, ColorWithOpacity } from "./types";

// Comprehensive color palette with common colors
const COLORS: ColorEntry[] = [
  // Reds
  { id: "red-50", name: "Red 50", hex: "#fef2f2", rgb: { r: 254, g: 242, b: 242 }, category: "red" },
  { id: "red-100", name: "Red 100", hex: "#fee2e2", rgb: { r: 254, g: 226, b: 226 }, category: "red" },
  { id: "red-200", name: "Red 200", hex: "#fecaca", rgb: { r: 254, g: 202, b: 202 }, category: "red" },
  { id: "red-300", name: "Red 300", hex: "#fca5a5", rgb: { r: 252, g: 165, b: 165 }, category: "red" },
  { id: "red-400", name: "Red 400", hex: "#f87171", rgb: { r: 248, g: 113, b: 113 }, category: "red" },
  { id: "red-500", name: "Red 500", hex: "#ef4444", rgb: { r: 239, g: 68, b: 68 }, category: "red" },
  { id: "red-600", name: "Red 600", hex: "#dc2626", rgb: { r: 220, g: 38, b: 38 }, category: "red" },
  { id: "red-700", name: "Red 700", hex: "#b91c1c", rgb: { r: 185, g: 28, b: 28 }, category: "red" },
  { id: "red-800", name: "Red 800", hex: "#991b1b", rgb: { r: 153, g: 27, b: 27 }, category: "red" },
  { id: "red-900", name: "Red 900", hex: "#7f1d1d", rgb: { r: 127, g: 29, b: 29 }, category: "red" },
  
  // Oranges
  { id: "orange-50", name: "Orange 50", hex: "#fff7ed", rgb: { r: 255, g: 247, b: 237 }, category: "orange" },
  { id: "orange-100", name: "Orange 100", hex: "#ffedd5", rgb: { r: 255, g: 237, b: 213 }, category: "orange" },
  { id: "orange-200", name: "Orange 200", hex: "#fed7aa", rgb: { r: 254, g: 215, b: 170 }, category: "orange" },
  { id: "orange-300", name: "Orange 300", hex: "#fdba74", rgb: { r: 253, g: 186, b: 116 }, category: "orange" },
  { id: "orange-400", name: "Orange 400", hex: "#fb923c", rgb: { r: 251, g: 146, b: 60 }, category: "orange" },
  { id: "orange-500", name: "Orange 500", hex: "#f97316", rgb: { r: 249, g: 115, b: 22 }, category: "orange" },
  { id: "orange-600", name: "Orange 600", hex: "#ea580c", rgb: { r: 234, g: 88, b: 12 }, category: "orange" },
  { id: "orange-700", name: "Orange 700", hex: "#c2410c", rgb: { r: 194, g: 65, b: 12 }, category: "orange" },
  { id: "orange-800", name: "Orange 800", hex: "#9a3412", rgb: { r: 154, g: 52, b: 18 }, category: "orange" },
  { id: "orange-900", name: "Orange 900", hex: "#7c2d12", rgb: { r: 124, g: 45, b: 18 }, category: "orange" },

  // Yellows
  { id: "yellow-50", name: "Yellow 50", hex: "#fefce8", rgb: { r: 254, g: 252, b: 232 }, category: "yellow" },
  { id: "yellow-100", name: "Yellow 100", hex: "#fef9c3", rgb: { r: 254, g: 249, b: 195 }, category: "yellow" },
  { id: "yellow-200", name: "Yellow 200", hex: "#fef08a", rgb: { r: 254, g: 240, b: 138 }, category: "yellow" },
  { id: "yellow-300", name: "Yellow 300", hex: "#fde047", rgb: { r: 253, g: 224, b: 71 }, category: "yellow" },
  { id: "yellow-400", name: "Yellow 400", hex: "#facc15", rgb: { r: 250, g: 204, b: 21 }, category: "yellow" },
  { id: "yellow-500", name: "Yellow 500", hex: "#eab308", rgb: { r: 234, g: 179, b: 8 }, category: "yellow" },
  { id: "yellow-600", name: "Yellow 600", hex: "#ca8a04", rgb: { r: 202, g: 138, b: 4 }, category: "yellow" },
  { id: "yellow-700", name: "Yellow 700", hex: "#a16207", rgb: { r: 161, g: 98, b: 7 }, category: "yellow" },
  { id: "yellow-800", name: "Yellow 800", hex: "#854d0e", rgb: { r: 133, g: 77, b: 14 }, category: "yellow" },
  { id: "yellow-900", name: "Yellow 900", hex: "#713f12", rgb: { r: 113, g: 63, b: 18 }, category: "yellow" },

  // Greens
  { id: "green-50", name: "Green 50", hex: "#f0fdf4", rgb: { r: 240, g: 253, b: 244 }, category: "green" },
  { id: "green-100", name: "Green 100", hex: "#dcfce7", rgb: { r: 220, g: 252, b: 231 }, category: "green" },
  { id: "green-200", name: "Green 200", hex: "#bbf7d0", rgb: { r: 187, g: 247, b: 208 }, category: "green" },
  { id: "green-300", name: "Green 300", hex: "#86efac", rgb: { r: 134, g: 239, b: 172 }, category: "green" },
  { id: "green-400", name: "Green 400", hex: "#4ade80", rgb: { r: 74, g: 222, b: 128 }, category: "green" },
  { id: "green-500", name: "Green 500", hex: "#22c55e", rgb: { r: 34, g: 197, b: 94 }, category: "green" },
  { id: "green-600", name: "Green 600", hex: "#16a34a", rgb: { r: 22, g: 163, b: 74 }, category: "green" },
  { id: "green-700", name: "Green 700", hex: "#15803d", rgb: { r: 21, g: 128, b: 61 }, category: "green" },
  { id: "green-800", name: "Green 800", hex: "#166534", rgb: { r: 22, g: 101, b: 52 }, category: "green" },
  { id: "green-900", name: "Green 900", hex: "#14532d", rgb: { r: 20, g: 83, b: 45 }, category: "green" },

  // Blues
  { id: "blue-50", name: "Blue 50", hex: "#eff6ff", rgb: { r: 239, g: 246, b: 255 }, category: "blue" },
  { id: "blue-100", name: "Blue 100", hex: "#dbeafe", rgb: { r: 219, g: 234, b: 254 }, category: "blue" },
  { id: "blue-200", name: "Blue 200", hex: "#bfdbfe", rgb: { r: 191, g: 219, b: 254 }, category: "blue" },
  { id: "blue-300", name: "Blue 300", hex: "#93c5fd", rgb: { r: 147, g: 197, b: 253 }, category: "blue" },
  { id: "blue-400", name: "Blue 400", hex: "#60a5fa", rgb: { r: 96, g: 165, b: 250 }, category: "blue" },
  { id: "blue-500", name: "Blue 500", hex: "#3b82f6", rgb: { r: 59, g: 130, b: 246 }, category: "blue" },
  { id: "blue-600", name: "Blue 600", hex: "#2563eb", rgb: { r: 37, g: 99, b: 235 }, category: "blue" },
  { id: "blue-700", name: "Blue 700", hex: "#1d4ed8", rgb: { r: 29, g: 78, b: 216 }, category: "blue" },
  { id: "blue-800", name: "Blue 800", hex: "#1e40af", rgb: { r: 30, g: 64, b: 175 }, category: "blue" },
  { id: "blue-900", name: "Blue 900", hex: "#1e3a8a", rgb: { r: 30, g: 58, b: 138 }, category: "blue" },

  // Purples
  { id: "purple-50", name: "Purple 50", hex: "#faf5ff", rgb: { r: 250, g: 245, b: 255 }, category: "purple" },
  { id: "purple-100", name: "Purple 100", hex: "#f3e8ff", rgb: { r: 243, g: 232, b: 255 }, category: "purple" },
  { id: "purple-200", name: "Purple 200", hex: "#e9d5ff", rgb: { r: 233, g: 213, b: 255 }, category: "purple" },
  { id: "purple-300", name: "Purple 300", hex: "#d8b4fe", rgb: { r: 216, g: 180, b: 254 }, category: "purple" },
  { id: "purple-400", name: "Purple 400", hex: "#c084fc", rgb: { r: 192, g: 132, b: 252 }, category: "purple" },
  { id: "purple-500", name: "Purple 500", hex: "#a855f7", rgb: { r: 168, g: 85, b: 247 }, category: "purple" },
  { id: "purple-600", name: "Purple 600", hex: "#9333ea", rgb: { r: 147, g: 51, b: 234 }, category: "purple" },
  { id: "purple-700", name: "Purple 700", hex: "#7e22ce", rgb: { r: 126, g: 34, b: 206 }, category: "purple" },
  { id: "purple-800", name: "Purple 800", hex: "#6b21a8", rgb: { r: 107, g: 33, b: 168 }, category: "purple" },
  { id: "purple-900", name: "Purple 900", hex: "#581c87", rgb: { r: 88, g: 28, b: 135 }, category: "purple" },

  // Pinks
  { id: "pink-50", name: "Pink 50", hex: "#fdf2f8", rgb: { r: 253, g: 242, b: 248 }, category: "pink" },
  { id: "pink-100", name: "Pink 100", hex: "#fce7f3", rgb: { r: 252, g: 231, b: 243 }, category: "pink" },
  { id: "pink-200", name: "Pink 200", hex: "#fbcfe8", rgb: { r: 251, g: 207, b: 232 }, category: "pink" },
  { id: "pink-300", name: "Pink 300", hex: "#f9a8d4", rgb: { r: 249, g: 168, b: 212 }, category: "pink" },
  { id: "pink-400", name: "Pink 400", hex: "#f472b6", rgb: { r: 244, g: 114, b: 182 }, category: "pink" },
  { id: "pink-500", name: "Pink 500", hex: "#ec4899", rgb: { r: 236, g: 72, b: 153 }, category: "pink" },
  { id: "pink-600", name: "Pink 600", hex: "#db2777", rgb: { r: 219, g: 39, b: 119 }, category: "pink" },
  { id: "pink-700", name: "Pink 700", hex: "#be185d", rgb: { r: 190, g: 24, b: 93 }, category: "pink" },
  { id: "pink-800", name: "Pink 800", hex: "#9d174d", rgb: { r: 157, g: 23, b: 77 }, category: "pink" },
  { id: "pink-900", name: "Pink 900", hex: "#831843", rgb: { r: 131, g: 24, b: 67 }, category: "pink" },

  // Grays
  { id: "gray-50", name: "Gray 50", hex: "#f9fafb", rgb: { r: 249, g: 250, b: 251 }, category: "gray" },
  { id: "gray-100", name: "Gray 100", hex: "#f3f4f6", rgb: { r: 243, g: 244, b: 246 }, category: "gray" },
  { id: "gray-200", name: "Gray 200", hex: "#e5e7eb", rgb: { r: 229, g: 231, b: 235 }, category: "gray" },
  { id: "gray-300", name: "Gray 300", hex: "#d1d5db", rgb: { r: 209, g: 213, b: 219 }, category: "gray" },
  { id: "gray-400", name: "Gray 400", hex: "#9ca3af", rgb: { r: 156, g: 163, b: 175 }, category: "gray" },
  { id: "gray-500", name: "Gray 500", hex: "#6b7280", rgb: { r: 107, g: 114, b: 128 }, category: "gray" },
  { id: "gray-600", name: "Gray 600", hex: "#4b5563", rgb: { r: 75, g: 85, b: 99 }, category: "gray" },
  { id: "gray-700", name: "Gray 700", hex: "#374151", rgb: { r: 55, g: 65, b: 81 }, category: "gray" },
  { id: "gray-800", name: "Gray 800", hex: "#1f2937", rgb: { r: 31, g: 41, b: 55 }, category: "gray" },
  { id: "gray-900", name: "Gray 900", hex: "#111827", rgb: { r: 17, g: 24, b: 39 }, category: "gray" },
];

const CATEGORY_LABELS: Record<string, string> = {
  red: "Reds",
  orange: "Oranges",
  yellow: "Yellows",
  green: "Greens",
  blue: "Blues",
  purple: "Purples",
  pink: "Pinks",
  gray: "Grays",
};

const OPACITY_PRESETS = [
  { value: 100, label: "100%" },
  { value: 95, label: "95%" },
  { value: 90, label: "90%" },
  { value: 85, label: "85%" },
  { value: 80, label: "80%" },
  { value: 75, label: "75%" },
  { value: 70, label: "70%" },
  { value: 65, label: "65%" },
  { value: 60, label: "60%" },
  { value: 50, label: "50%" },
  { value: 40, label: "40%" },
  { value: 30, label: "30%" },
  { value: 25, label: "25%" },
  { value: 20, label: "20%" },
  { value: 15, label: "15%" },
  { value: 10, label: "10%" },
  { value: 5, label: "5%" },
  { value: 0, label: "0%" },
];

function hexToRgba(hex: string, opacity: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const a = opacity / 100;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}

function hexWithAlpha(hex: string, opacity: number): string {
  const alpha = Math.round((opacity / 100) * 255);
  const alphaHex = alpha.toString(16).padStart(2, "0");
  return `${hex}${alphaHex}`;
}

function getColorContent(hex: string): { value: string } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${hex}" rx="32"/></svg>`;
  return { value: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

export default function ColorTools() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [opacity, setOpacity] = useState(100);
  const [searchText, setSearchText] = useState("");

  const filteredColors = useMemo(() => {
    let colors = COLORS;

    if (selectedCategory !== "all") {
      colors = colors.filter((c) => c.category === selectedCategory);
    }

    if (searchText.trim() !== "") {
      const query = searchText.toLowerCase();
      colors = colors.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.hex.toLowerCase().includes(query) ||
          c.category.toLowerCase().includes(query),
      );
    }

    return colors;
  }, [selectedCategory, searchText]);

  const colorsWithOpacity: ColorWithOpacity[] = useMemo(() => {
    return filteredColors.map((color) => ({
      ...color,
      opacity,
      hexWithOpacity: hexWithAlpha(color.hex, opacity),
      rgba: hexToRgba(color.hex, opacity),
    }));
  }, [filteredColors, opacity]);

  return (
    <Grid
      columns={8}
      fit={Grid.Fit.Contain}
      aspectRatio="1"
      filtering
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search colors by name or hex..."
      searchBarAccessory={
        <>
          <Grid.Dropdown
            tooltip="Filter by color category"
            storeValue
            onChange={setSelectedCategory}
            value={selectedCategory}
          >
            <Grid.Dropdown.Item title="All Colors" value="all" />
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <Grid.Dropdown.Item key={value} title={label} value={value} />
            ))}
          </Grid.Dropdown>
          <Grid.Dropdown
            tooltip="Opacity"
            storeValue
            onChange={(newValue) => setOpacity(Number(newValue))}
            value={String(opacity)}
          >
            {OPACITY_PRESETS.map((preset) => (
              <Grid.Dropdown.Item
                key={preset.value}
                title={preset.label}
                value={String(preset.value)}
              />
            ))}
          </Grid.Dropdown>
        </>
      }
    >
      {colorsWithOpacity.length === 0 ? (
        <Grid.EmptyView
          title="No colors found"
          description="Try a different search term or category"
          icon={Icon.EyeDropper}
        />
      ) : (
        <Grid.Section
          title={
            selectedCategory === "all"
              ? "All Colors"
              : CATEGORY_LABELS[selectedCategory]
          }
          subtitle={`${colorsWithOpacity.length} colors • ${opacity}% opacity`}
        >
          {colorsWithOpacity.map((color) => (
            <Grid.Item
              key={color.id}
              id={color.id}
              content={getColorContent(color.hex)}
              title={color.name}
              subtitle={opacity === 100 ? color.hex : color.hexWithOpacity}
              keywords={[color.hex, color.category, color.rgba]}
              actions={<ColorActions color={color} />}
            />
          ))}
        </Grid.Section>
      )}
    </Grid>
  );
}

function ColorActions({ color }: { color: ColorWithOpacity }) {
  return (
    <ActionPanel>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy Hex"
          content={color.opacity === 100 ? color.hex : color.hexWithOpacity}
          icon={Icon.CopyClipboard}
          onCopy={async () => {
            await showToast({
              style: Toast.Style.Success,
              title: "Copied Hex",
              message: color.opacity === 100 ? color.hex : color.hexWithOpacity,
            });
          }}
        />
        <Action.CopyToClipboard
          title="Copy RGBA"
          content={color.rgba}
          icon={Icon.CopyClipboard}
          onCopy={async () => {
            await showToast({
              style: Toast.Style.Success,
              title: "Copied RGBA",
              message: color.rgba,
            });
          }}
        />
        <Action.CopyToClipboard
          title="Copy RGB"
          content={`rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`}
          icon={Icon.CopyClipboard}
          onCopy={async () => {
            await showToast({
              style: Toast.Style.Success,
              title: "Copied RGB",
              message: `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`,
            });
          }}
        />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy CSS Variable"
          content={`--color-${color.id}: ${color.hex};`}
          icon={Icon.Code}
          onCopy={async () => {
            await showToast({
              style: Toast.Style.Success,
              title: "Copied CSS Variable",
            });
          }}
        />
        <Action.CopyToClipboard
          title="Copy Tailwind Class"
          content={`bg-${color.id}`}
          icon={Icon.Code}
          onCopy={async () => {
            await showToast({
              style: Toast.Style.Success,
              title: "Copied Tailwind Class",
            });
          }}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}
