import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { StartupContextEstimate } from "./runtime-types";

const STRIP_CELLS = 14;
const CONFIG_MODULE_URL = new URL(
  "../../npm/node_modules/pi-context-view/src/config.ts",
  import.meta.url,
).href;
const COLOR_MODULE_URL = new URL(
  "../../npm/node_modules/pi-context-view/src/ui/color.ts",
  import.meta.url,
).href;
const MAP_MODULE_URL = new URL(
  "../../npm/node_modules/pi-context-view/src/ui/usage-map.ts",
  import.meta.url,
).href;

type CategoryColor = ThemeColor | `#${string}`;
interface UsageMapCell {
  readonly categoryId?: string;
  readonly fill: "full" | "partial" | "buffer" | "free";
}
interface UsageMap {
  readonly cells: readonly UsageMapCell[];
}
interface ContextUsageInput {
  readonly computedAt: Date;
  readonly reported: { readonly contextWindow: number };
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
    readonly tokens: number;
  }[];
  readonly estimatedTokens: number;
  readonly autoCompactReserveTokens: number;
}

export interface ContextStripConfig {
  readonly categoryColors: ReadonlyMap<string, CategoryColor>;
  readonly bufferCategoryId: string;
  readonly freeCategoryId: string;
  readonly resolveCategoryColor: (
    colors: ReadonlyMap<string, CategoryColor>,
    categoryId: string | undefined,
  ) => CategoryColor;
  readonly colorize: (theme: Theme, color: CategoryColor, text: string) => string;
  readonly buildUsageMap: (
    usage: ContextUsageInput,
    columns?: number,
    rows?: number,
  ) => UsageMap | undefined;
}

interface ConfigModule {
  readonly AUTO_COMPACT_BUFFER_CATEGORY_ID: string;
  readonly FREE_SPACE_CATEGORY_ID: string;
  readonly ConfigStore: new () => {
    load(): { config: { categoryColors: ReadonlyMap<string, CategoryColor> } };
  };
  readonly resolveCategoryColor: ContextStripConfig["resolveCategoryColor"];
}
interface ColorModule {
  readonly colorize: ContextStripConfig["colorize"];
}
interface MapModule {
  readonly buildUsageMap: ContextStripConfig["buildUsageMap"];
}

export async function loadContextViewConfig(): Promise<ContextStripConfig | undefined> {
  try {
    const [configModule, colorModule, mapModule] = (await Promise.all([
      import(CONFIG_MODULE_URL),
      import(COLOR_MODULE_URL),
      import(MAP_MODULE_URL),
    ])) as unknown as [ConfigModule, ColorModule, MapModule];
    return {
      categoryColors: new configModule.ConfigStore().load().config.categoryColors,
      bufferCategoryId: configModule.AUTO_COMPACT_BUFFER_CATEGORY_ID,
      freeCategoryId: configModule.FREE_SPACE_CATEGORY_ID,
      resolveCategoryColor: configModule.resolveCategoryColor,
      colorize: colorModule.colorize,
      buildUsageMap: mapModule.buildUsageMap,
    };
  } catch {
    return undefined;
  }
}

export function renderInitialContextStrip(
  theme: Theme,
  estimate: StartupContextEstimate,
  config: ContextStripConfig,
): string {
  const map = config.buildUsageMap(
    {
      computedAt: new Date(0),
      reported: { contextWindow: estimate.contextWindowTokens },
      categories: estimate.categories.map(({ id, tokens }) => ({ id, label: id, tokens })),
      estimatedTokens: estimate.estimatedTokens,
      autoCompactReserveTokens: estimate.autoCompactReserveTokens,
    },
    STRIP_CELLS,
    1,
  );
  if (map === undefined) return "";

  const cells = map.cells
    .map((cell) => {
      const categoryId =
        cell.fill === "buffer"
          ? config.bufferCategoryId
          : cell.fill === "free"
            ? config.freeCategoryId
            : cell.categoryId;
      const glyph =
        categoryId === "compacted-data"
          ? "▦"
          : cell.fill === "full"
            ? "■"
            : cell.fill === "partial"
              ? "◧"
              : cell.fill === "buffer"
                ? "⛝"
                : "⛶";
      return config.colorize(
        theme,
        config.resolveCategoryColor(config.categoryColors, categoryId),
        glyph,
      );
    })
    .join("");
  const reserve = estimate.autoCompactReserveTokens;
  return `context ${cells} ${formatTokens(estimate.estimatedTokens)}/${formatTokens(estimate.contextWindowTokens)}${reserve === 0 ? "" : ` · reserve ${formatTokens(reserve)}`}`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${Math.round(tokens / 1_000)}k`;
}
