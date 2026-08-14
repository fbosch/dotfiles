import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { parseWpctlVolume, type VolumeInfo } from "./model";

type VolumeCommand = (cancellable: Gio.Cancellable) => Promise<string>;

const minimumReadIntervalMs = 30;

export class VolumeSource {
	readonly #run: VolumeCommand;
	readonly #useAstalWp: boolean;
	#latest: VolumeInfo = { volume: 0, muted: false };
	#audioPromise: Promise<any> | null = null;
	#astalWpUnavailable = false;
	#pending: Promise<VolumeInfo> | null = null;
	#scheduled:
		| {
				promise: Promise<VolumeInfo>;
				resolve: (info: VolumeInfo) => void;
		  }
		| null = null;
	#scheduledSource = 0;
	#lastReadStartedAt = 0;
	#cancellable: Gio.Cancellable | null = null;
	#process: Gio.Subprocess | null = null;
	#disposed = false;

	constructor(run?: VolumeCommand) {
		this.#run = run ?? ((cancellable) => this.#runWpctl(cancellable));
		this.#useAstalWp = run === undefined;
	}

	init(): void {
		this.#disposed = false;
	}

	read(): Promise<VolumeInfo> {
		if (this.#disposed) return Promise.resolve(this.#latest);
		if (this.#useAstalWp && this.#astalWpUnavailable === false)
			return this.#readAstalWp();
		return this.#readWpctl();
	}

	#readWpctl(): Promise<VolumeInfo> {
		if (this.#pending) return this.#pending;
		if (this.#scheduled) return this.#scheduled.promise;
		const elapsed = Date.now() - this.#lastReadStartedAt;
		const delay = Math.max(0, minimumReadIntervalMs - elapsed);
		if (delay === 0) return this.#execute();
		let resolve: (info: VolumeInfo) => void = () => {};
		const promise = new Promise<VolumeInfo>((resolvePromise) => {
			resolve = resolvePromise;
		});
		this.#scheduled = { promise, resolve };
		this.#scheduledSource = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			delay,
			() => {
				this.#scheduledSource = 0;
				const scheduled = this.#scheduled;
				this.#scheduled = null;
				if (this.#disposed) {
					scheduled?.resolve(this.#latest);
					return GLib.SOURCE_REMOVE;
				}
				void this.#execute().then((info) => scheduled?.resolve(info));
				return GLib.SOURCE_REMOVE;
			},
		);
		return promise;
	}

	async #readAstalWp(): Promise<VolumeInfo> {
		try {
			this.#audioPromise ??= import("gi://AstalWp").then(({ default: AstalWp }) =>
				AstalWp.get_default(),
			);
			const audio = await this.#audioPromise;
			if (this.#disposed) return this.#latest;
			const speaker =
				audio?.get_default_speaker?.() ?? audio?.default_speaker ?? null;
			if (!speaker) throw new Error("AstalWP default speaker unavailable");
			const rawVolume = Number(
				speaker.get_volume?.() ?? speaker.volume ?? 0,
			);
			this.#latest = {
				volume: Math.round(rawVolume <= 1.5 ? rawVolume * 100 : rawVolume),
				muted: Boolean(
					speaker.get_mute?.() ??
						speaker.get_muted?.() ??
						speaker.mute ??
						speaker.muted ??
						false,
				),
			};
			return this.#latest;
		} catch (error) {
			this.#astalWpUnavailable = true;
			console.error("AstalWP volume source unavailable, using wpctl:", error);
			return this.#readWpctl();
		}
	}

	dispose(): void {
		this.#disposed = true;
		if (this.#scheduledSource !== 0) {
			GLib.source_remove(this.#scheduledSource);
			this.#scheduledSource = 0;
		}
		this.#scheduled?.resolve(this.#latest);
		this.#scheduled = null;
		this.#cancellable?.cancel();
		this.#cancellable = null;
		try {
			this.#process?.force_exit();
		} catch {
			// The process may have exited between cancellation and cleanup.
		}
		this.#process = null;
	}

	#execute(): Promise<VolumeInfo> {
		this.#lastReadStartedAt = Date.now();
		const cancellable = new Gio.Cancellable();
		this.#cancellable = cancellable;
		const pending = this.#run(cancellable)
			.then((output) => {
				this.#latest = parseWpctlVolume(output);
				return this.#latest;
			})
			.catch((error) => {
				if (!cancellable.is_cancelled())
					console.error("Failed to get volume info:", error);
				return this.#latest;
			})
			.finally(() => {
				if (this.#pending === pending) this.#pending = null;
				if (this.#cancellable === cancellable) this.#cancellable = null;
				this.#process = null;
			});
		this.#pending = pending;
		return pending;
	}

	#runWpctl(cancellable: Gio.Cancellable): Promise<string> {
		this.#process = Gio.Subprocess.new(
			["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
		);
		const process = this.#process;
		return new Promise((resolve, reject) => {
			process.communicate_utf8_async(null, cancellable, (_process, result) => {
				try {
					const [ok, stdout, stderr] = process.communicate_utf8_finish(result);
					if (!ok || !process.get_successful())
						throw new Error(stderr || "wpctl get-volume failed");
					resolve(stdout ?? "");
				} catch (error) {
					reject(error);
				}
			});
		});
	}
}
