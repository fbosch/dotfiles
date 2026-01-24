import type { LightState } from "./types";

type FetchOptions = {
	baseUrl: string;
	accessToken: string;
};

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

async function request<T>(
	path: string,
	options: FetchOptions,
	init?: RequestInit,
): Promise<T> {
	const url = `${normalizeBaseUrl(options.baseUrl)}${path}`;
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${options.accessToken}`,
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
		});
	} catch (error) {
		throw new Error(
			`Home Assistant network error: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	if (!response.ok) {
		const message = await response.text().catch(() => "");
		throw new Error(
			`Home Assistant request failed: ${response.status} ${response.statusText}${message ? ` - ${message}` : ""}`,
		);
	}

	try {
		return (await response.json()) as T;
	} catch (error) {
		throw new Error(
			`Home Assistant response error: ${error instanceof Error ? error.message : "Invalid JSON"}`,
		);
	}
}

export async function fetchLights(options: FetchOptions): Promise<LightState[]> {
	const states = await request<LightState[]>("/api/states", options);
	return states.filter((state) => state.entity_id.startsWith("light."));
}

export async function callLightService(
	service: "turn_on" | "turn_off" | "toggle",
	entityId: string,
	options: FetchOptions,
): Promise<void> {
	await request(`/api/services/light/${service}`, options, {
		method: "POST",
		body: JSON.stringify({ entity_id: entityId }),
	});
}
