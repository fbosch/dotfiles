import {
  Action,
  ActionPanel,
  Clipboard,
  closeMainWindow,
  environment,
  getPreferenceValues,
  Icon,
  LaunchProps,
  List,
  open,
  openCommandPreferences,
  showToast,
  Toast,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import {
  checkClamAVInstalled,
  checkDatabaseStatus,
  formatDuration,
  getClamAVVersion,
  scanPath,
} from "./scanner";
import type { ScanResult, ScanStatus, ScanSummary } from "./types";

type Preferences = {
  recursiveScan: boolean;
  showInfectedOnly: boolean;
  removeInfected: boolean;
  excludePatterns: string;
};

// Helper to get home directory with fallback
function getHomeDir(): string {
  return environment.HOME || process.env.HOME || "/tmp";
}

function ScanDirectoryContent({ fallbackText }: { fallbackText?: string }) {
  const prefs = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState(fallbackText || "");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("pending");
  const [results, setResults] = useState<ScanResult[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [clamavInstalled, setClamavInstalled] = useState<boolean | null>(null);
  const [clamavVersion, setClamavVersion] = useState<string>("");
  const [selectedPath, setSelectedPath] = useState<string>(getHomeDir());

  // Check ClamAV installation on mount
  useEffect(() => {
    async function checkInstallation() {
      const installed = await checkClamAVInstalled();
      setClamavInstalled(installed);

      if (installed) {
        try {
          const version = await getClamAVVersion();
          setClamavVersion(version);
        } catch (error) {
          console.error("Failed to get ClamAV version:", error);
        }
      }
    }
    checkInstallation();
  }, []);

  async function handleScan(targetPath: string) {
    if (!clamavInstalled) {
      await showToast({
        style: Toast.Style.Failure,
        title: "ClamAV Not Installed",
        message: "Please install ClamAV using: nix-env -iA nixpkgs.clamav",
      });
      return;
    }

    setScanStatus("scanning");
    setResults([]);
    setSummary(null);

    try {
      // Check database status
      const dbStatus = await checkDatabaseStatus();
      if (!dbStatus.exists) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Virus Database Missing",
          message:
            "Use 'Update Virus Database' command or run 'sudo freshclam' in terminal",
        });
        setScanStatus("error");
        return;
      }

      await showToast({
        style: Toast.Style.Animated,
        title: "Scanning...",
        message: `Scanning ${targetPath}`,
      });

      const excludePatterns = prefs.excludePatterns
        ? prefs.excludePatterns.split(",").map((p) => p.trim())
        : [];

      const scanResult = await scanPath(targetPath, {
        recursive: prefs.recursiveScan,
        infectedOnly: prefs.showInfectedOnly,
        remove: prefs.removeInfected,
        excludePatterns,
      });

      setResults(scanResult.results);
      setSummary(scanResult.summary);
      setScanStatus("completed");

      if (scanResult.summary.infectedFiles > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Threats Found!",
          message: `Found ${scanResult.summary.infectedFiles} infected file(s)`,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Scan Complete",
          message: `No threats found. Scanned ${scanResult.summary.totalFiles} files`,
        });
      }
    } catch (error) {
      setScanStatus("error");
      await showToast({
        style: Toast.Style.Failure,
        title: "Scan Failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (clamavInstalled === false) {
    return (
      <List>
        <List.EmptyView
          title="ClamAV Not Installed"
          description="Install ClamAV to scan for viruses"
          icon={Icon.XmarkCircle}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Install Command"
                content="nix-env -iA nixpkgs.clamav"
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const commonDirectories = [
    { name: "Home", path: getHomeDir(), icon: Icon.House },
    { name: "Downloads", path: `${getHomeDir()}/Downloads`, icon: Icon.Download },
    { name: "Documents", path: `${getHomeDir()}/Documents`, icon: Icon.Document },
    { name: "Desktop", path: `${getHomeDir()}/Desktop`, icon: Icon.Desktop },
    { name: "Root", path: "/", icon: Icon.HardDrive },
  ];

  return (
    <List
      isLoading={scanStatus === "scanning" || clamavInstalled === null}
      searchBarPlaceholder="Enter path to scan or select from common directories..."
      onSearchTextChange={setSearchText}
      searchText={searchText}
    >
      {scanStatus === "pending" && (
        <>
          <List.Section title="Quick Scan">
            {commonDirectories.map((dir) => (
              <List.Item
                key={dir.path}
                title={dir.name}
                subtitle={dir.path}
                icon={dir.icon}
                accessories={[{ text: "Press Enter to scan" }]}
                actions={
                  <ActionPanel>
                    <Action
                      title="Scan Directory"
                      icon={Icon.MagnifyingGlass}
                      onAction={() => handleScan(dir.path)}
                    />
                    <Action
                      title="Scan Custom Path"
                      icon={Icon.Pencil}
                      onAction={() => {
                        if (searchText.trim()) {
                          handleScan(searchText.trim());
                        }
                      }}
                      shortcut={{ modifiers: ["cmd"], key: "return" }}
                    />
                    <ActionPanel.Section>
                      <Action
                        title="Open Preferences"
                        icon={Icon.Gear}
                        onAction={openCommandPreferences}
                        shortcut={{ modifiers: ["cmd"], key: "," }}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
          {searchText.trim() && (
            <List.Section title="Custom Path">
              <List.Item
                title={`Scan: ${searchText}`}
                subtitle="Press Enter to scan this path"
                icon={Icon.Folder}
                actions={
                  <ActionPanel>
                    <Action
                      title="Scan Path"
                      icon={Icon.MagnifyingGlass}
                      onAction={() => handleScan(searchText.trim())}
                    />
                  </ActionPanel>
                }
              />
            </List.Section>
          )}
          {clamavVersion && (
            <List.Section title="System Information">
              <List.Item
                title="ClamAV Version"
                subtitle={clamavVersion}
                icon={Icon.CheckCircle}
              />
            </List.Section>
          )}
        </>
      )}

      {scanStatus === "completed" && summary && (
        <>
          <List.Section
            title={`Scan Results - ${summary.infectedFiles > 0 ? "⚠️ THREATS FOUND" : "✓ Clean"}`}
          >
            <List.Item
              title="Summary"
              icon={
                summary.infectedFiles > 0 ? Icon.XmarkCircle : Icon.CheckCircle
              }
              accessories={[
                { text: `${summary.totalFiles} files scanned` },
                { text: summary.duration || "" },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title="New Scan"
                    icon={Icon.ArrowClockwise}
                    onAction={() => {
                      setScanStatus("pending");
                      setResults([]);
                      setSummary(null);
                    }}
                    shortcut={{ modifiers: ["cmd"], key: "n" }}
                  />
                  <Action.CopyToClipboard
                    title="Copy Summary"
                    content={JSON.stringify(summary, null, 2)}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                </ActionPanel>
              }
            />
          </List.Section>

          {results.length > 0 && (
            <List.Section
              title={
                summary.infectedFiles > 0
                  ? `Infected Files (${summary.infectedFiles})`
                  : `Scanned Files (${results.length})`
              }
            >
              {results.map((result, idx) => (
                <List.Item
                  key={`${result.path}-${idx}`}
                  title={result.path.split("/").pop() || result.path}
                  subtitle={result.path}
                  icon={
                    result.status === "infected"
                      ? Icon.ExclamationMark
                      : result.status === "clean"
                        ? Icon.CheckCircle
                        : Icon.XmarkCircle
                  }
                  accessories={
                    result.virus
                      ? [{ text: result.virus, icon: Icon.Bug }]
                      : result.error
                        ? [{ text: result.error }]
                        : [{ text: "Clean" }]
                  }
                  actions={
                    <ActionPanel>
                      <Action
                        title="Open in File Manager"
                        icon={Icon.Folder}
                        onAction={async () => {
                          await open(result.path);
                          await closeMainWindow();
                        }}
                        shortcut={{ modifiers: ["cmd"], key: "o" }}
                      />
                      <Action.CopyToClipboard
                        title="Copy Path"
                        content={result.path}
                        shortcut={{ modifiers: ["cmd"], key: "c" }}
                      />
                      {result.virus && (
                        <Action.CopyToClipboard
                          title="Copy Virus Name"
                          content={result.virus}
                          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                        />
                      )}
                      <ActionPanel.Section>
                        <Action
                          title="New Scan"
                          icon={Icon.ArrowClockwise}
                          onAction={() => {
                            setScanStatus("pending");
                            setResults([]);
                            setSummary(null);
                          }}
                          shortcut={{ modifiers: ["cmd"], key: "n" }}
                        />
                      </ActionPanel.Section>
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          )}

          <List.Section title="Statistics">
            <List.Item
              title="Total Files"
              accessories={[{ text: summary.totalFiles.toString() }]}
              icon={Icon.Document}
            />
            <List.Item
              title="Infected Files"
              accessories={[{ text: summary.infectedFiles.toString() }]}
              icon={Icon.Bug}
            />
            <List.Item
              title="Clean Files"
              accessories={[{ text: summary.cleanFiles.toString() }]}
              icon={Icon.CheckCircle}
            />
            <List.Item
              title="Scan Duration"
              accessories={[{ text: summary.duration || "N/A" }]}
              icon={Icon.Clock}
            />
          </List.Section>
        </>
      )}
    </List>
  );
}

export default function ScanDirectory(props: LaunchProps) {
  return <ScanDirectoryContent fallbackText={props.fallbackText} />;
}
