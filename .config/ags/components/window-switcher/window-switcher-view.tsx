import app from "ags/gtk4/app";
import { createRoot } from "ags";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import {
	getFallbackLetter,
	getIconForWindow,
	setImageFile,
} from "../../services/app-icons";
import { perf } from "../../services/performance-monitor";
import { getPointerMonitor } from "../../services/pointer-monitor";
import {
	debugLog,
	debugWriteFile,
	monitorDebugPath,
	windowSwitcherDebugPath,
} from "./diagnostics";
import type { WindowInfo } from "./machine";
import { PreviewCache, type PreviewInfo } from "./preview-cache";
import { DisplayMode, ICON_SIZE } from "./styles";
import { splitWindowRows, truncateWindowTitle } from "./view-policy";

const buttonSpacing = 8;
const buttonPadding = 8;
const iconButtonWidth = ICON_SIZE + buttonPadding * 2 + 4 + 12;

type Session = { windows: WindowInfo[]; currentIndex: number };
type ViewOptions = { onSelect: (index: number) => void; onCommit: () => void };
type ResolvedPreview = { path: string | null; info: PreviewInfo };
type PreviewWidgets = {
	path: string | null;
	mtime: number;
	header: Gtk.Box;
	body: Gtk.Box;
	title: Gtk.Label;
	picture: Gtk.Picture | null;
};

export class WindowSwitcherView {
	#window: Astal.Window | null = null;
	#container: Gtk.Box | null = null;
	#selectedLabel: Gtk.Label | null = null;
	#buttons = new Map<string, Gtk.Button>();
	#indices = new Map<string, number>();
	#iconTheme: Gtk.IconTheme | null = null;
	#previousAddresses: string[] = [];
	#previousMode: DisplayMode | null = null;
	#previewWidgets = new Map<string, PreviewWidgets>();
	#windowDispose: (() => void) | null = null;
	#renderDispose: (() => void) | null = null;

	constructor(
		private readonly previews: PreviewCache,
		private readonly options: ViewOptions,
	) {}

	create(): Astal.Window {
		if (this.#window) return this.#window;
		const display = Gdk.Display.get_default();
		if (display) this.#iconTheme = Gtk.IconTheme.get_for_display(display);
		createRoot((dispose) => {
			this.#windowDispose = dispose;
			this.#window = (
			<window
				name="window-switcher"
				namespace="ags-window-switcher"
				visible={false}
				anchor={
					Astal.WindowAnchor.TOP |
					Astal.WindowAnchor.BOTTOM |
					Astal.WindowAnchor.LEFT |
					Astal.WindowAnchor.RIGHT
				}
				layer={Astal.Layer.OVERLAY}
				exclusivity={Astal.Exclusivity.IGNORE}
				keymode={Astal.Keymode.NONE}
				application={app}
				class="window-switcher"
			>
				<box
					orientation={Gtk.Orientation.VERTICAL}
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.CENTER}
				>
					<box
						orientation={Gtk.Orientation.VERTICAL}
						spacing={12}
						class="switcher-container"
					>
						<box
							orientation={Gtk.Orientation.VERTICAL}
							spacing={8}
							halign={Gtk.Align.CENTER}
							class="apps-container"
							$={(self: Gtk.Box) => {
								this.#container = self;
							}}
						/>
						<label
							label=""
							halign={Gtk.Align.CENTER}
							class="app-name"
							ellipsize={3}
							maxWidthChars={50}
							$={(self: Gtk.Label) => {
								this.#selectedLabel = self;
							}}
						/>
					</box>
				</box>
			</window>
			) as Astal.Window;
		});
		if (!this.#window) throw new Error("Failed to create Window Switcher view");
		return this.#window;
	}

	show(): void {
		this.#window?.set_keymode(Astal.Keymode.EXCLUSIVE);
		this.#window?.set_visible(true);
	}

	hide(): void {
		this.#window?.set_visible(false);
		this.#window?.set_keymode(Astal.Keymode.NONE);
	}

	render(session: Session, mode: DisplayMode): void {
		if (!this.#container || !this.#selectedLabel) return;
		const mark = perf.start("window-switcher", "updateSwitcher");
		let ok = true;
		let error: string | undefined;

		try {
			const addresses = session.windows.map((window) => window.address);
			this.#indices.clear();
			session.windows.forEach((window, index) =>
				this.#indices.set(window.address, index),
			);
			if (
				this.#previousMode !== mode ||
				this.#hasSameWindowSet(addresses) === false
			)
				this.#rebuild(session, mode, addresses);
			else if (this.#hasSameWindowOrder(addresses) === false)
				this.#reorder(session, mode, addresses);
			else this.#updateSelection(session);
			this.#selectedLabel.set_label(
				session.windows[session.currentIndex]?.title ?? "",
			);
		} catch (cause) {
			ok = false;
			error = String(cause);
			throw cause;
		} finally {
			mark.end(ok, error);
		}
	}

	reset(): void {
		this.#previousAddresses = [];
		this.#buttons.clear();
		this.#indices.clear();
		this.#previewWidgets.clear();
	}

	refreshPreviews(windows: WindowInfo[]): void {
		if (this.#previousMode !== DisplayMode.PREVIEWS) return;
		for (const window of windows) {
			const widgets = this.#previewWidgets.get(window.address);
			if (!widgets) continue;
			const path = this.previews.getPath(window);
			const info = this.previews.getInfo(path);
			if (widgets.path === path && widgets.mtime === info.mtime) continue;

			widgets.path = path;
			widgets.mtime = info.mtime;
			widgets.header.set_size_request(info.width, -1);
			widgets.body.set_size_request(info.width, info.height);
			widgets.title.set_label(
				truncateWindowTitle(window.title, info.width - 52),
			);
			if (info.texture) {
				if (widgets.picture) widgets.picture.set_paintable(info.texture);
				else {
					widgets.picture = createPreviewPicture(info.texture);
					widgets.body.append(widgets.picture);
				}
			} else if (widgets.picture) {
				widgets.body.remove(widgets.picture);
				widgets.picture = null;
			}
		}
	}

	dispose(): void {
		this.#renderDispose?.();
		this.#windowDispose?.();
		this.#renderDispose = null;
		this.#windowDispose = null;
		this.#window = null;
		this.#container = null;
		this.#selectedLabel = null;
		this.#iconTheme = null;
		this.#previousAddresses = [];
		this.#previousMode = null;
		this.#previewWidgets.clear();
		this.#buttons.clear();
		this.#indices.clear();
	}

	#hasSameWindowSet(addresses: string[]): boolean {
		if (this.#previousAddresses.length !== addresses.length) return false;
		const previous = new Set(this.#previousAddresses);
		return addresses.every((address) => previous.has(address));
	}

	#hasSameWindowOrder(addresses: string[]): boolean {
		return this.#previousAddresses.every(
			(address, index) => address === addresses[index],
		);
	}

	#rebuild(session: Session, mode: DisplayMode, addresses: string[]): void {
		this.#renderDispose?.();
		this.#renderDispose = null;
		this.#clearContainer();
		this.#buttons.clear();
		this.#previewWidgets.clear();
		const previews = new Map<string, ResolvedPreview>();
		const widths = session.windows.map((window) => {
			if (mode === DisplayMode.ICONS) return iconButtonWidth;
			const preview = this.#resolvePreview(window);
			previews.set(window.address, preview);
			return preview.info.width + buttonPadding * 2 + 4 + 48;
		});
		const rows = this.#layoutRows(session.windows, widths);
		createRoot((dispose) => {
			this.#renderDispose = dispose;
			for (const row of rows) this.#appendRow(row, session, mode, previews);
		});
		this.#previousAddresses = addresses;
		this.#previousMode = mode;
	}

	#reorder(session: Session, mode: DisplayMode, addresses: string[]): void {
		const widths = session.windows.map((window) => {
			if (mode === DisplayMode.ICONS) return iconButtonWidth;
			const widgets = this.#previewWidgets.get(window.address);
			if (!widgets) throw new Error(`Missing preview widgets for ${window.address}`);
			widgets.title.set_label(
				truncateWindowTitle(window.title, widgets.body.widthRequest - 52),
			);
			return widgets.body.widthRequest + buttonPadding * 2 + 4 + 48;
		});
		const rows = this.#layoutRows(session.windows, widths);
		for (const button of this.#buttons.values()) {
			const parent = button.get_parent();
			if (parent instanceof Gtk.Box) parent.remove(button);
		}
		this.#clearContainer();
		for (const windows of rows) this.#appendExistingRow(windows);
		this.#previousAddresses = addresses;
		this.#updateSelection(session);
	}

	#layoutRows(windows: WindowInfo[], widths: number[]): WindowInfo[][] {
		const monitorWidth = getMonitorWidth();
		const maxWidth = Math.floor(monitorWidth * 0.75);
		const totalWidth =
			widths.reduce((sum, width) => sum + width, 0) +
			(windows.length - 1) * buttonSpacing;
		debugWriteFile(
			windowSwitcherDebugPath,
			`[Window Switcher Debug - ${new Date().toISOString()}]\nMonitor: ${monitorWidth}px\nMax width (75% of monitor): ${maxWidth}px\nButton widths: [${widths.join(", ")}]\nTotal width needed: ${totalWidth}px\nWill wrap: ${totalWidth > maxWidth}\n`,
		);
		debugLog(`[Window Switcher] Button widths: [${widths.join(", ")}]`);
		debugLog(
			`[Window Switcher] Monitor: ${monitorWidth}px, Available (75%): ${maxWidth}px, Total needed: ${totalWidth}px, Will wrap: ${totalWidth > maxWidth}`,
		);
		const rows =
			totalWidth > maxWidth
				? splitWindowRows(windows, widths, maxWidth)
				: [windows];
		debugLog(`Using ${rows.length > 1 ? "multi" : "single"}-row layout`);
		return rows;
	}

	#clearContainer(): void {
		let child = this.#container?.get_first_child() ?? null;
		while (child && this.#container) {
			this.#container.remove(child);
			child = this.#container.get_first_child();
		}
	}

	#appendRow(
		windows: WindowInfo[],
		session: Session,
		mode: DisplayMode,
		previews: ReadonlyMap<string, ResolvedPreview>,
	): void {
		const row = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: buttonSpacing,
			halign: Gtk.Align.CENTER,
		});
		row.add_css_class("apps-row");
		for (const window of windows) {
			const index = session.windows.indexOf(window);
			const button = this.#createButton(
				window,
				index === session.currentIndex,
				mode,
				previews.get(window.address),
			);
			row.append(button);
			this.#buttons.set(window.address, button);
		}
		this.#container?.append(row);
	}

	#appendExistingRow(windows: WindowInfo[]): void {
		const row = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: buttonSpacing,
			halign: Gtk.Align.CENTER,
		});
		row.add_css_class("apps-row");
		for (const window of windows) {
			const button = this.#buttons.get(window.address);
			if (!button) throw new Error(`Missing button for ${window.address}`);
			row.append(button);
		}
		this.#container?.append(row);
	}

	#createButton(
		window: WindowInfo,
		selected: boolean,
		mode: DisplayMode,
		preview: ResolvedPreview | undefined,
	): Gtk.Button {
		const mark = perf.start("window-switcher", "createAppButton");
		let ok = true;
		let error: string | undefined;

		try {
			const icon = getIconForWindow(window, this.#iconTheme);
			const fallback = getFallbackLetter(window);
			let content: JSX.Element;
			if (mode === DisplayMode.PREVIEWS) {
				if (!preview) throw new Error(`Missing preview for ${window.address}`);
				content = this.#previewContent(window, icon, fallback, preview);
			} else content = this.#iconContent(icon, fallback);
			return (
				<button
					canFocus={false}
					class={`app-button ${selected ? "selected" : ""}`}
					onClicked={() => {
						const index = this.#indices.get(window.address);
						if (index === undefined) return;
						this.options.onSelect(index);
						this.options.onCommit();
					}}
				>
					{content}
				</button>
			) as Gtk.Button;
		} catch (cause) {
			ok = false;
			error = String(cause);
			throw cause;
		} finally {
			mark.end(ok, error);
		}
	}

	#previewContent(
		window: WindowInfo,
		icon: ReturnType<typeof getIconForWindow>,
		fallback: string,
		preview: ResolvedPreview,
	): JSX.Element {
		const { path, info } = preview;
		let header: Gtk.Box | null = null;
		let title: Gtk.Label | null = null;
		const image = icon ? (
			icon.kind === "theme" ? (
				<image
					iconName={icon.name}
					pixelSize={20}
					class="preview-header-icon"
				/>
			) : (
				<image
					pixelSize={20}
					class="preview-header-icon"
					$={(self: Gtk.Image) => setImageFile(self, icon.path)}
				/>
			)
		) : (
			<box class="preview-header-icon-fallback">
				<label label={fallback} class="preview-header-letter" />
			</box>
		);
		return (
			<box
				orientation={Gtk.Orientation.VERTICAL}
				spacing={0}
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
				class="preview-wrapper"
			>
				<box
					orientation={Gtk.Orientation.VERTICAL}
					spacing={0}
					class="window-preview"
					widthRequest={info.width}
				>
					<box
						orientation={Gtk.Orientation.HORIZONTAL}
						spacing={8}
						class="preview-header"
						halign={Gtk.Align.FILL}
						widthRequest={info.width}
						$={(self: Gtk.Box) => {
							header = self;
						}}
					>
						{image}
						<label
							label={truncateWindowTitle(window.title, info.width - 52)}
							xalign={0}
							class="preview-header-title"
							wrap={false}
							$={(self: Gtk.Label) => {
								title = self;
							}}
						/>
					</box>
					<box
						class="preview-body"
						halign={Gtk.Align.CENTER}
						valign={Gtk.Align.CENTER}
						widthRequest={info.width}
						heightRequest={info.height}
						$={(body: Gtk.Box) => {
							const picture = info.texture
								? createPreviewPicture(info.texture)
								: null;
							if (picture) body.append(picture);
							if (header && title)
								this.#previewWidgets.set(window.address, {
									path,
									mtime: info.mtime,
									header,
									body,
									title,
									picture,
								});
						}}
					/>
				</box>
			</box>
		);
	}

	#iconContent(
		icon: ReturnType<typeof getIconForWindow>,
		fallback: string,
	): JSX.Element {
		const image = icon ? (
			icon.kind === "theme" ? (
				<image
					iconName={icon.name}
					pixelSize={ICON_SIZE}
					class="app-icon-image"
				/>
			) : (
				<image
					pixelSize={ICON_SIZE}
					class="app-icon-image"
					$={(self: Gtk.Image) => setImageFile(self, icon.path)}
				/>
			)
		) : (
			<box class="app-icon-wrapper">
				<label
					label={fallback}
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.CENTER}
					class="app-icon-letter"
				/>
			</box>
		);
		return (
			<box
				orientation={Gtk.Orientation.VERTICAL}
				spacing={0}
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
			>
				<box
					orientation={Gtk.Orientation.HORIZONTAL}
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.CENTER}
					class={`icon-container ${icon ? "" : "letter-icon"}`}
				>
					{image}
				</box>
			</box>
		);
	}

	#resolvePreview(window: WindowInfo): ResolvedPreview {
		const path = this.previews.getPath(window);
		return { path, info: this.previews.getInfo(path) };
	}

	#updateSelection(session: Session): void {
		session.windows.forEach((window, index) => {
			const button = this.#buttons.get(window.address);
			if (!button) return;
			const selected = button.get_css_classes().includes("selected");
			if (index === session.currentIndex && selected === false)
				button.add_css_class("selected");
			if (index !== session.currentIndex && selected)
				button.remove_css_class("selected");
		});
	}
}

function createPreviewPicture(texture: Gdk.Texture): Gtk.Picture {
	const picture = Gtk.Picture.new_for_paintable(texture);
	picture.set_halign(Gtk.Align.FILL);
	picture.set_valign(Gtk.Align.FILL);
	picture.set_can_shrink(false);
	picture.set_content_fit(Gtk.ContentFit.FILL);
	picture.add_css_class("preview-image");
	return picture;
}

function getMonitorWidth(): number {
	try {
		const pointerMonitor = getPointerMonitor();
		if (!pointerMonitor) {
			debugWriteFile(monitorDebugPath, "No monitor at pointer\n");
			return 1920;
		}
		const { monitor, x, y } = pointerMonitor;
		const geometry = monitor.get_geometry();
		debugWriteFile(
			monitorDebugPath,
			`Monitor: ${monitor.get_model() || "unknown"}\nGeometry width: ${geometry.width}\nGeometry height: ${geometry.height}\nScale factor: ${monitor.get_scale_factor()}\nPhysical width: ${geometry.width * monitor.get_scale_factor()}\nMouse position: ${x},${y}\n`,
		);
		return geometry.width;
	} catch (error) {
		debugWriteFile(monitorDebugPath, `Error: ${error}\n`);
		console.error("Failed to get monitor width:", error);
		return 1920;
	}
}
