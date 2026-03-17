import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { CONFIG } from "../config.js";
import type { MemoryScopeContext } from "../types/index.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

let cachedUserId: string | null = null;

export function getGitEmail(): Promise<string | null> {
  return new Promise((resolve) => {
    exec("git config user.email", { encoding: "utf-8" }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const email = stdout.trim();
      resolve(email || null);
    });
  });
}

export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const email = await getGitEmail();
  if (email) {
    cachedUserId = sha256(email);
    return cachedUserId;
  }
  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  cachedUserId = sha256(fallback);
  return cachedUserId;
}

export function getProjectId(directory: string): string {
  return sha256(directory);
}

export async function getScopes(directory: string): Promise<{ user: MemoryScopeContext; project: MemoryScopeContext }> {
  const userId = await getUserId();
  const projectId = getProjectId(directory);
  
  return {
    user: { userId },
    project: { userId, projectId },
  };
}

// Legacy tag-based functions for backward compatibility
export async function getUserTag(): Promise<string> {
  return `${CONFIG.scopePrefix}_user_${await getUserId()}`;
}

export function getProjectTag(directory: string): string {
  return `${CONFIG.scopePrefix}_project_${getProjectId(directory)}`;
}

export async function getTags(directory: string): Promise<{ user: string; project: string }> {
  return {
    user: await getUserTag(),
    project: getProjectTag(directory),
  };
}
