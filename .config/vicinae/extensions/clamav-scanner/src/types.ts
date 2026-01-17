export type ScanStatus = "pending" | "scanning" | "completed" | "error";

export type ScanResult = {
  path: string;
  status: "clean" | "infected" | "error";
  virus?: string;
  error?: string;
};

export type ScanSummary = {
  totalFiles: number;
  infectedFiles: number;
  cleanFiles: number;
  errors: number;
  scannedDirectories: number;
  startTime: Date;
  endTime?: Date;
  duration?: string;
};

export type ScanProgress = {
  currentFile: string;
  filesScanned: number;
  totalFiles?: number;
  percentage?: number;
};
