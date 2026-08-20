import GLib from "gi://GLib?version=2.0";

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function encodeAccessibilityHelperArgument(value: string): string {
	return GLib.base64_encode(new TextEncoder().encode(value));
}

export function decodeAccessibilityHelperArgument(value: string): string | null {
	if (value.length === 0 || base64Pattern.test(value) === false) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(GLib.base64_decode(value));
	} catch {
		return null;
	}
}
