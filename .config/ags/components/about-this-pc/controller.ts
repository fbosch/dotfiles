import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import { dispatchHyprland } from "../../services/hyprland-ipc";
import { AboutThisPCView } from "./about-this-pc-view";
import type { AboutThisPCInfo } from "./model";
import { launchAboutMoreInfo } from "./more-info";
import { getAboutThisPCInfo } from "./system-info";

interface AboutThisPCControllerOptions {
	view?: AboutThisPCView;
	getInfo?(cancellable: Gio.Cancellable | null): Promise<AboutThisPCInfo>;
	launchMoreInfo?(): boolean;
}

export class AboutThisPCController {
	readonly #view: AboutThisPCView;
	readonly #getInfo: NonNullable<AboutThisPCControllerOptions["getInfo"]>;
	readonly #launchMoreInfo: NonNullable<AboutThisPCControllerOptions["launchMoreInfo"]>;
	#cancellable: Gio.Cancellable | null = null;
	#generation = 0;
	#shutdownSignalId = 0;

	constructor(options: AboutThisPCControllerOptions = {}) {
		this.#view = options.view ?? new AboutThisPCView();
		this.#getInfo = options.getInfo ?? getAboutThisPCInfo;
		this.#launchMoreInfo = options.launchMoreInfo ?? launchAboutMoreInfo;
	}

	init(): void {
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	show(): void {
		if (this.#view.isMapped) {
			this.#view.present();
			dispatchHyprland('hl.dsp.focus({ window = "title:^(About This PC)$" })', {
				component: "about-this-pc",
				metric: "focus",
			});
			return;
		}
		this.#destroyView();
		this.#view.create({
			onClose: () => this.hide(),
			onMoreInfo: () => this.#showMoreInfo(),
			onUnmapped: () => this.#cancelLoad(),
		});
		this.#view.present();
		this.#view.focusMoreInfo();
		this.#view.showStatus("Loading system information...");
		const cancellable = new Gio.Cancellable();
		this.#cancellable = cancellable;
		const generation = ++this.#generation;
		void this.#getInfo(cancellable)
			.then((info) => {
				if (generation !== this.#generation || cancellable.is_cancelled()) return;
				this.#view.render(info);
			})
			.catch((error) => {
				if (generation !== this.#generation || cancellable.is_cancelled()) return;
				console.error("Failed to load system information:", error);
				this.#view.showStatus("System information is unavailable.");
			});
	}

	hide(): void {
		this.#destroyView();
	}

	destroy(): void {
		this.#destroyView();
	}

	get isVisible(): boolean {
		return this.#view.isMapped;
	}

	teardown(): void {
		this.#destroyView();
		if (this.#shutdownSignalId !== 0) {
			app.disconnect(this.#shutdownSignalId);
			this.#shutdownSignalId = 0;
		}
	}

	#showMoreInfo(): void {
		if (this.#launchMoreInfo()) {
			this.#view.hideStatus();
			return;
		}
		this.#view.showStatus(
			"The More Info command or a supported terminal is unavailable.",
		);
	}

	#cancelLoad(): void {
		this.#generation += 1;
		this.#cancellable?.cancel();
		this.#cancellable = null;
	}

	#destroyView(): void {
		this.#cancelLoad();
		this.#view.destroy();
	}
}
