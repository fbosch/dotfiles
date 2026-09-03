import type { CredentialStore } from "@earendil-works/pi-ai";

export type ProviderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type UsageUrgency = "urgent" | "soon" | "later" | "unknown";

export type ProfileProviderCredential = {
  accessToken: string;
  expiresAt: number;
  identity: string;
};

export type ProfileCredentialReadResult =
  | { kind: "missing" }
  | { kind: "invalid-auth-file" }
  | { kind: "invalid-provider-credential" }
  | { kind: "valid"; credential: ProfileProviderCredential };

export type ProviderUsageWindow = {
  remaining: number;
  resetsIn?: string;
};

export type ProviderUsageSnapshot = {
  windows: ProviderUsageWindow[];
  availableCreditCount?: number;
};

export type ProviderCreditSnapshot = {
  availableCount: number;
  urgency: UsageUrgency;
};

export type ProfileCredentialRefreshRequest = {
  expectedIdentity: string;
  profileLabel: string;
};

/** Provider-specific operations required by automatic profile selection. */
export interface ProfileProviderAdapter {
  readonly providerId: string;
  createCredentialStore(profileLabel: string): Promise<CredentialStore>;
  readCredential(profileLabel: string): Promise<ProfileCredentialReadResult>;
  refreshCredential(request: ProfileCredentialRefreshRequest): Promise<ProfileProviderCredential>;
  fetchUsage(
    credential: ProfileProviderCredential,
    fetchFn: ProviderFetch,
  ): Promise<ProviderUsageSnapshot>;
  fetchCredits?(
    credential: ProfileProviderCredential,
    fetchFn: ProviderFetch,
    now: number,
  ): Promise<ProviderCreditSnapshot>;
  usageLimitResetAt(headers: Record<string, string>, now: number): number | undefined;
  usageLimitResetAtFromMessage(message: string | undefined, now: number): number | undefined;
}
