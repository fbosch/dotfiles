import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import catastrophicCommandGuard, { catastrophicCommandReason } from "../catastrophic-command-guard";

const FORMATTER_REASON = "Blocked filesystem formatter command on block device.";
const WIPEFS_REASON = "Blocked destructive wipefs operation on block device.";
const RAW_WRITE_REASON = "Blocked raw write to block device.";
const SHRED_REASON = "Blocked shred of block device.";
const ROOT_DELETE_REASON = "Blocked recursive deletion of filesystem root.";

const blockedCommands = [
  ["mkfs.ext4 /dev/sda1", FORMATTER_REASON],
  ["sudo -n /sbin/mke2fs /dev/nvme0n1", FORMATTER_REASON],
  ["doas -u root newfs_msdos /dev/rdisk2", FORMATTER_REASON],
  ["mkdosfs /dev/loop0", FORMATTER_REASON],
  ["mkswap /dev/mapper/swap", FORMATTER_REASON],
  ["mkfs.xfs /dev/dm-0", FORMATTER_REASON],
  ["mkfs.ext4 /dev/md127", FORMATTER_REASON],
  ["mkfs.ext4 /dev/disk/by-id/usb-example", FORMATTER_REASON],
  ["wipefs --all /dev/vda", WIPEFS_REASON],
  ["wipefs --offset 0x438 /dev/sda", WIPEFS_REASON],
  ["diskutil eraseDisk APFS Empty /dev/disk4", "Blocked whole-disk diskutil operation."],
  [
    "sudo diskutil partitionDisk disk4 GPT APFS Empty 100%",
    "Blocked whole-disk diskutil operation.",
  ],
  ["dd if=/dev/zero of=/dev/sda bs=1M", RAW_WRITE_REASON],
  ["dd if=/dev/zero of=/dev/rdisk3", RAW_WRITE_REASON],
  ["dd if=/dev/zero of=/dev/mapper/cryptroot", RAW_WRITE_REASON],
  ["dd if=/dev/zero of=/dev/dm-0", RAW_WRITE_REASON],
  ["dd if=/dev/zero of=/dev/md0", RAW_WRITE_REASON],
  ["dd if=/dev/zero of=/dev/disk/by-id/ata-example", RAW_WRITE_REASON],
  ["dd of=output.img of=/dev/vda if=/dev/zero", RAW_WRITE_REASON],
  ["dd if=/dev/zero > /dev/sda", RAW_WRITE_REASON],
  ["dd if=/dev/zero 1>/dev/mapper/cryptroot", RAW_WRITE_REASON],
  ["shred -n 1 /dev/mmcblk0", SHRED_REASON],
  ["shred /dev/rdisk4", SHRED_REASON],
  ["shred /dev/mapper/cryptroot", SHRED_REASON],
  ["shred /dev/dm-0", SHRED_REASON],
  ["shred /dev/md0", SHRED_REASON],
  ["shred /dev/disk/by-id/ata-example", SHRED_REASON],
  ["rm -rf /", ROOT_DELETE_REASON],
  ["rm / -f -r", ROOT_DELETE_REASON],
  ["rm --force --recursive -- /", ROOT_DELETE_REASON],
  ["rm --force --rec //", ROOT_DELETE_REASON],
  ["rm -rf /./", ROOT_DELETE_REASON],
  ["rm -fr //*", ROOT_DELETE_REASON],
  ["rm -fr /./*", ROOT_DELETE_REASON],
  ["bash -c 'rm -rf /'", ROOT_DELETE_REASON],
  ["bash -o errexit -c 'rm -rf /'", ROOT_DELETE_REASON],
  ["sh -o nounset -c 'dd if=/dev/zero of=/dev/disk3'", RAW_WRITE_REASON],
  ["command sudo mkfs.ext4 /dev/sda", FORMATTER_REASON],
  ["exec env dd if=/dev/zero of=/dev/vda", RAW_WRITE_REASON],
  ["env -S 'sudo rm -rf /'", ROOT_DELETE_REASON],
  ["env -S'mkfs.ext4 /dev/sda'", FORMATTER_REASON],
  ["env --split-string='command mkfs.ext4' /dev/sda", FORMATTER_REASON],
  [">guard.log sudo mkfs.ext4 /dev/sda", FORMATTER_REASON],
  ["2>&1 >guard.log exec mkfs.ext4 /dev/sda", FORMATTER_REASON],
  ["if true; then mkfs.ext4 /dev/sda; fi", FORMATTER_REASON],
  ["echo ok # <<'EOF'\nmkfs.ext4 /dev/sda", FORMATTER_REASON],
  ["echo ready && mkfs.xfs /dev/vdb", FORMATTER_REASON],
  ["mkfs.ext4 \\\n/dev/sda", FORMATTER_REASON],
] as const;

const allowedCommands: string[] = [
  "mkfs.ext4",
  "wipefs",
  "mkfs.ext4 --help",
  "mkfs.ext4 -n /dev/sda",
  "mkfs.ext4 disk.img",
  "mkdosfs disk.img",
  "mkswap swap.img",
  "wipefs /dev/sda",
  "wipefs --no-act --all /dev/sda",
  "rm -rf build",
  "rm -rf /tmp/x",
  'rm -rf "/*"',
  "rm -rf /\\*",
  "dd if=input.bin of=output.bin",
  "dd if=/dev/zero of=/dev/sda of=disk.img",
  "dd if=input.bin 2>/dev/sda",
  "git reset --hard",
  "echo 'rm -rf /'",
  'printf "%s\\n" mkfs wipefs',
  "printf '%s\\n' {mkfs.ext4,wipefs}",
  "tool -- mkfs.ext4 /dev/sda",
  "command -v mkfs.ext4 /dev/sda",
  "bash -c 'echo \"rm -rf /\"'",
  "echo diskutil eraseDisk disk4",
  "shred old-backup.img",
  "echo ok # mkfs.ext4 /dev/sda",
  "cat <<'EOF'\nmkfs.ext4 /dev/sda\nwipefs --all /dev/sda\nEOF",
  'cat <<"DATA"\nrm -rf /\nDATA',
];

describe("catastrophic command detection", () => {
  test.each(blockedCommands)("blocks %s", (command, reason) => {
    expect(catastrophicCommandReason(command)).toBe(reason);
  });

  test.each(allowedCommands)("allows %s", (command) => {
    expect(catastrophicCommandReason(command)).toBeUndefined();
  });
});

test("the extension blocks only matching bash tool calls", () => {
  let handler: ((event: unknown) => unknown) | undefined;
  const pi = {
    on(event: string, candidate: (event: unknown) => unknown) {
      if (event === "tool_call") handler = candidate;
    },
  } as unknown as ExtensionAPI;
  catastrophicCommandGuard(pi);

  expect(
    handler?.({
      type: "tool_call",
      toolName: "bash",
      toolCallId: "dangerous",
      input: { command: "sudo rm --recursive --force -- /" },
    }),
  ).toEqual({ block: true, reason: ROOT_DELETE_REASON });
  expect(
    handler?.({
      type: "tool_call",
      toolName: "bash",
      toolCallId: "ordinary",
      input: { command: "rm -rf dist" },
    }),
  ).toBeUndefined();
  expect(
    handler?.({
      type: "tool_call",
      toolName: "read",
      toolCallId: "not-bash",
      input: { path: "mkfs.ext4" },
    }),
  ).toBeUndefined();
});
