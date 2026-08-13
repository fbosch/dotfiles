#!/usr/bin/env bun

import { env, stderr } from "node:process";
import { styleText } from "node:util";
import {
    createPrompt,
    isDownKey,
    isEnterKey,
    isSpaceKey,
    isUpKey,
    useKeypress,
    usePagination,
    useState,
} from "@inquirer/core";
import { z } from "zod";

const updateSchema = z.object({
    name: z.string(),
    currentShort: z.string(),
    newShort: z.string(),
});

const inputSchema = z.object({
    timestamp: z.string(),
    updates: z.array(updateSchema),
});

const environmentSchema = z.object({
    FLAKE_PATH: z.string().min(1),
    FLAKE_UPDATE_CACHE: z.string().min(1),
});

type Update = z.infer<typeof updateSchema>;
type PickerConfig = {
    timestamp: string;
    updates: Update[];
};

const pageSize = 10;

function relativeTime(timestamp: string): string {
    const checkedAt = Date.parse(timestamp);
    const ageSeconds = Math.max(0, Math.floor((Date.now() - checkedAt) / 1000));
    if (ageSeconds < 60) return "just now";

    const minutes = Math.floor(ageSeconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

const chooseUpdates = createPrompt<string[], PickerConfig>((config, done) => {
    const [active, setActive] = useState(0);
    const [selected, setSelected] = useState<string[]>([]);
    useKeypress((key, readline) => {
        if (key.ctrl && key.name === "r") {
            done(["__refresh__"]);
            return;
        }

        if (isEnterKey(key)) {
            done(selected);
            return;
        }

        if (isSpaceKey(key)) {
            readline.clearLine(0);
            const name = config.updates[active]?.name;
            if (!name) return;

            setSelected(selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name]);
            return;
        }

        const moveUp = isUpKey(key) || (!key.ctrl && key.name === "k");
        const moveDown = isDownKey(key) || (!key.ctrl && key.name === "j");
        if (moveUp || moveDown) {
            readline.clearLine(0);
            const offset = moveUp ? -1 : 1;
            setActive((active + offset + config.updates.length) % config.updates.length);
        }
    });

    const options = usePagination({
        items: config.updates,
        active,
        pageSize,
        renderItem: ({ item, isActive }) => {
            const isSelected = selected.includes(item.name);
            const marker = isSelected ? "[x]" : "[ ]";
            const line = `${isActive ? "❯" : " "} ${marker} ${item.name}: ${item.currentShort} → ${item.newShort}`;
            if (isActive && isSelected) {
                return styleText(["bgGreen", "black", "bold"], line);
            }

            if (isActive) {
                return styleText(["bgCyan", "black", "bold"], line);
            }

            return isSelected ? styleText(["green", "bold"], line) : styleText("dim", line);
        },
    });

    return [
        styleText("cyan", `Checked ${relativeTime(config.timestamp)}`),
        "",
        "Select flake inputs to update",
        options,
        "",
        styleText("dim", "↑↓/jk navigate  Space toggle  Enter confirm  Ctrl-R re-check"),
    ].join("\n");
});

async function main(): Promise<void> {
    const { FLAKE_UPDATE_CACHE } = environmentSchema.parse(env);
    const parsed = inputSchema.parse(JSON.parse(FLAKE_UPDATE_CACHE));
    if (parsed.updates.length === 0) {
        process.exit(0);
    }

    const selected = await chooseUpdates(parsed, { output: stderr });
    process.stdout.write(`${JSON.stringify(selected)}\n`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
