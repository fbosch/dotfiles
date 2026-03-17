import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

const PATH_ENTRIES = [
  join(home, ".local/bin"),
  join(home, ".local/share/pnpm"),
  join(home, "Library/pnpm"),
  join(home, ".npm-packages/bin"),
  join(home, ".bun/bin"),
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
];

function fishShell() {
  const user = home.split("/").pop();
  const nixFish = `/etc/profiles/per-user/${user}/bin/fish`;
  return nixFish;
}

function mergePath(pathValue: string | undefined) {
  const current = pathValue?.split(":").filter(Boolean) ?? [];
  return [...new Set([...PATH_ENTRIES, ...current])].join(":");
}

export default async function ShellPathPlugin() {
  return {
    "shell.env": async (_input, output) => {
      output.env.PATH = mergePath(output.env.PATH || process.env.PATH);
      output.env.SHELL = fishShell();
    },
  };
}
