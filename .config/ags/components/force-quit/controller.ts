import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { dispatchHyprland } from "@/services/hyprland-ipc";
import { getForceQuitApplications } from "./application-repository";
import { ForceQuitView } from "./force-quit-view";
import { ForceQuitMetricsSampler } from "./metrics";
import {
	applicationTopologyMatches,
	type ForceQuitApplication,
	type ForceQuitMetrics,
} from "./model";
import {
	forceQuitApplication,
	type ForceQuitOperation,
	type ForceQuitResult,
} from "./termination";

const metricRefreshMs = 2_000;

interface ForceQuitControllerOptions {
	view?: ForceQuitView;
	getApplications?(iconTheme?: Gtk.IconTheme | null): ForceQuitApplication[] | null;
	metrics?: ForceQuitMetricsSampler;
	terminate?(
		application: ForceQuitApplication,
		onComplete: (result: ForceQuitResult) => void,
	): ForceQuitOperation;
}

export class ForceQuitController {
	readonly #view: ForceQuitView;
	readonly #getApplications: NonNullable<ForceQuitControllerOptions["getApplications"]>;
	readonly #metricsSampler: ForceQuitMetricsSampler;
	readonly #terminate: NonNullable<ForceQuitControllerOptions["terminate"]>;
	#applications: ForceQuitApplication[] | null = [];
	#metrics = new Map<string, ForceQuitMetrics>();
	#selectedApplicationId: string | null = null;
	#terminationPending = false;
	#operation: ForceQuitOperation | null = null;
	#metricRefreshSource = 0;
	#shutdownSignalId = 0;
	#visible = false;
	#operationGeneration = 0;

	constructor(options: ForceQuitControllerOptions = {}) {
		this.#view = options.view ?? new ForceQuitView();
		this.#getApplications = options.getApplications ?? getForceQuitApplications;
		this.#metricsSampler = options.metrics ?? new ForceQuitMetricsSampler();
		this.#terminate = options.terminate ?? forceQuitApplication;
	}

	init(): void {
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	show(): void {
		if (this.#view.isMapped) {
			this.#view.present();
			dispatchHyprland(
				'hl.dsp.focus({ window = "title:^(Force Quit Applications)$" })',
				{ component: "force-quit", metric: "focus" },
			);
			return;
		}
		this.#destroyView();
		this.#view.create({
			onClose: () => this.hide(),
			onForceQuit: () => this.#forceQuitSelected(),
			onSelect: (applicationId) => this.#select(applicationId),
			onUnmapped: () => this.#handleUnmapped(),
		});
		this.#metricsSampler.clear();
		this.#refreshApplications(true);
		this.#view.present();
		this.#visible = true;
		this.#startMetricRefresh();
	}

	hide(): void {
		this.#cancelOperation();
		this.#destroyView();
	}

	destroy(): void {
		this.#cancelOperation();
		this.#destroyView();
	}

	get isVisible(): boolean {
		return this.#view.isMapped;
	}

	teardown(): void {
		this.#cancelOperation();
		this.#destroyView();
		if (this.#shutdownSignalId !== 0) {
			app.disconnect(this.#shutdownSignalId);
			this.#shutdownSignalId = 0;
		}
	}

	#select(applicationId: string): void {
		if (this.#applications?.some((application) => application.id === applicationId) !== true)
			return;
		this.#selectedApplicationId = applicationId;
		this.#render();
	}

	#forceQuitSelected(): void {
		if (this.#terminationPending || !this.#applications || !this.#selectedApplicationId)
			return;
		const selected = this.#applications.find(
			(application) => application.id === this.#selectedApplicationId,
		);
		if (!selected) {
			this.#selectedApplicationId = null;
			this.#render();
			return;
		}
		this.#terminationPending = true;
		this.#render();
		const generation = ++this.#operationGeneration;
		const operation = this.#terminate(selected, () => {
			if (generation !== this.#operationGeneration) return;
			this.#terminationPending = false;
			this.#operation = null;
			this.#selectedApplicationId = null;
			if (this.#visible) this.#refreshApplications();
		});
		if (this.#terminationPending) this.#operation = operation;
	}

	#refreshApplications(focusFirst = false): void {
		const display = Gdk.Display.get_default();
		const iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
		this.#applications = this.#getApplications(iconTheme);
		if (
			this.#applications?.some(
				(application) => application.id === this.#selectedApplicationId,
			) === false
		)
			this.#selectedApplicationId = null;
		this.#metrics = this.#applications
			? this.#metricsSampler.sample(this.#applications)
			: new Map();
		this.#render(focusFirst);
	}

	#refreshVisibleState(): void {
		if (!this.#visible) return;
		const display = Gdk.Display.get_default();
		const iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
		const latest = this.#getApplications(iconTheme);
		const topologyChanged =
			applicationTopologyMatches(this.#applications, latest) === false;
		this.#applications = latest;
		if (
			this.#applications?.some(
				(application) => application.id === this.#selectedApplicationId,
			) === false
		)
			this.#selectedApplicationId = null;
		if (topologyChanged) {
			this.#metrics = this.#applications
				? this.#metricsSampler.sample(this.#applications)
				: new Map();
			this.#render();
			return;
		}
		if (!this.#applications) return;
		this.#metrics = this.#metricsSampler.sample(this.#applications);
		this.#view.updateMetrics(this.#applications, this.#metrics);
	}

	#render(focusFirst = false): void {
		this.#view.render(
			{
				applications: this.#applications,
				metrics: this.#metrics,
				selectedApplicationId: this.#selectedApplicationId,
				terminationPending: this.#terminationPending,
			},
			focusFirst,
		);
	}

	#startMetricRefresh(): void {
		this.#clearMetricRefresh();
		this.#metricRefreshSource = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			metricRefreshMs,
			() => {
				this.#refreshVisibleState();
				return GLib.SOURCE_CONTINUE;
			},
		);
	}

	#clearMetricRefresh(): void {
		if (this.#metricRefreshSource === 0) return;
		GLib.source_remove(this.#metricRefreshSource);
		this.#metricRefreshSource = 0;
	}

	#handleUnmapped(): void {
		this.#cancelOperation();
		this.#visible = false;
		this.#clearMetricRefresh();
		this.#metricsSampler.clear();
	}

	#destroyView(): void {
		this.#visible = false;
		this.#clearMetricRefresh();
		this.#metricsSampler.clear();
		this.#selectedApplicationId = null;
		this.#view.destroy();
	}

	#cancelOperation(): void {
		this.#operationGeneration += 1;
		this.#operation?.cancel();
		this.#operation = null;
		this.#terminationPending = false;
	}
}
