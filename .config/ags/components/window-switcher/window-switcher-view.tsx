import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import {
	getFallbackLetter,
	getIconForWindow,
	setImageFile,
} from "../../services/app-icons";
import { perf } from "../../services/performance-monitor";
import {
	debugLog,
	debugWriteFile,
	monitorDebugPath,
	windowSwitcherDebugPath,
} from "./diagnostics";
import type { WindowInfo } from "./machine";
import { PreviewCache } from "./preview-cache";
import { DisplayMode, ICON_SIZE } from "./styles";

const buttonSpacing = 8;
const buttonPadding = 8;

type Session = { windows: WindowInfo[]; currentIndex: number };
type ViewOptions = { onSelect: (index: number) => void; onCommit: () => void };

export class WindowSwitcherView {
	#window: Astal.Window | null = null;
	#container: Gtk.Box | null = null;
	#selectedLabel: Gtk.Label | null = null;
	#buttons = new Map<string, Gtk.Button>();
	#iconTheme: Gtk.IconTheme | null = null;
	#previousAddresses: string[] = [];
	#previousMode: DisplayMode | null = null;
	#previousMtimes = new Map<string, number>();

	constructor(
		private readonly previews: PreviewCache,
		private readonly options: ViewOptions,
	) {}

	create(): Astal.Window {
		const display = Gdk.Display.get_default();
		if (display) this.#iconTheme = Gtk.IconTheme.get_for_display(display);
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
			const rebuild = this.#shouldRebuild(session.windows, addresses, mode);
			if (rebuild) this.#rebuild(session, mode, addresses);
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
	}

	#shouldRebuild(
		windows: WindowInfo[],
		addresses: string[],
		mode: DisplayMode,
	): boolean {
		const listChanged =
			this.#previousAddresses.length !== addresses.length ||
			this.#previousAddresses.some(
				(address, index) => address !== addresses[index],
			);
		if (listChanged || this.#previousMode !== mode) return true;
		if (mode === DisplayMode.ICONS) return false;
		const mtimes = this.#previewMtimes(windows);
		for (const [address, mtime] of mtimes)
			if (this.#previousMtimes.get(address) !== mtime) return true;
		return false;
	}

	#rebuild(session: Session, mode: DisplayMode, addresses: string[]): void {
		let child = this.#container?.get_first_child() ?? null;
		while (child && this.#container) {
			this.#container.remove(child);
			child = this.#container.get_first_child();
		}
		this.#buttons.clear();
		const widths = session.windows.map((window) =>
			this.#buttonWidth(window, mode),
		);
		const monitorWidth = getMonitorWidth();
		const maxWidth = Math.floor(monitorWidth * 0.75);
		const totalWidth =
			widths.reduce((sum, width) => sum + width, 0) +
			(session.windows.length - 1) * buttonSpacing;
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
				? splitRows(session.windows, widths, maxWidth)
				: [session.windows];
		debugLog(`Using ${rows.length > 1 ? "multi" : "single"}-row layout`);
		for (const row of rows) this.#appendRow(row, session, mode);
		this.#previousAddresses = addresses;
		this.#previousMode = mode;
		this.#previousMtimes =
			mode === DisplayMode.PREVIEWS
				? this.#previewMtimes(session.windows)
				: new Map();
	}

	#appendRow(windows: WindowInfo[], session: Session, mode: DisplayMode): void {
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
				index,
				mode,
			);
			row.append(button);
			this.#buttons.set(window.address, button);
		}
		this.#container?.append(row);
	}

	#createButton(
		window: WindowInfo,
		selected: boolean,
		index: number,
		mode: DisplayMode,
	): Gtk.Button {
		const mark = perf.start("window-switcher", "createAppButton");
		let ok = true;
		let error: string | undefined;

		try {
			const icon = getIconForWindow(window, this.#iconTheme);
			const fallback = getFallbackLetter(window);
			const content =
				mode === DisplayMode.PREVIEWS
					? this.#previewContent(window, icon, fallback)
					: this.#iconContent(icon, fallback);
			return (
				<button
					canFocus={false}
					class={`app-button ${selected ? "selected" : ""}`}
					onClicked={() => {
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
	): JSX.Element {
		const path = this.previews.getPath(window);
		const info = this.previews.getInfo(path);
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
					css={`max-width: ${info.width}px;`}
				>
					<box
						orientation={Gtk.Orientation.HORIZONTAL}
						spacing={8}
						class="preview-header"
						halign={Gtk.Align.FILL}
						widthRequest={info.width}
					>
						{image}
						<label
							label={truncateTitle(window.title, info.width - 52)}
							xalign={0}
							class="preview-header-title"
							wrap={false}
						/>
					</box>
					<box
						class="preview-body"
						halign={Gtk.Align.CENTER}
						valign={Gtk.Align.CENTER}
						css={`min-width: ${info.width}px; min-height: ${info.height}px; max-width: ${info.width}px; max-height: ${info.height}px;`}
						$={(self: Gtk.Box) => this.#appendPreview(self, path)}
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

	#appendPreview(container: Gtk.Box, path: string | null): void {
		if (!path) return;
		const texture = this.previews.getInfo(path).texture;
		if (!texture) return;
		const picture = Gtk.Picture.new_for_paintable(texture);
		picture.set_halign(Gtk.Align.FILL);
		picture.set_valign(Gtk.Align.FILL);
		picture.set_can_shrink(false);
		picture.set_content_fit(Gtk.ContentFit.FILL);
		picture.add_css_class("preview-image");
		container.append(picture);
	}

	#buttonWidth(window: WindowInfo, mode: DisplayMode): number {
		if (mode === DisplayMode.ICONS)
			return ICON_SIZE + buttonPadding * 2 + 4 + 12;
		const info = this.previews.getInfo(this.previews.getPath(window));
		return info.width + buttonPadding * 2 + 4 + 48;
	}

	#previewMtimes(windows: WindowInfo[]): Map<string, number> {
		const mtimes = new Map<string, number>();
		for (const window of windows) {
			const mtime = this.previews.getMtime(this.previews.getPath(window));
			if (mtime !== null) mtimes.set(window.address, mtime);
		}
		return mtimes;
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

function truncateTitle(title: string, availableWidth: number): string {
	const maxChars = Math.floor((availableWidth - 12) / 6);
	if (maxChars <= 0) return "…";
	return title.length <= maxChars ? title : `${title.substring(0, maxChars)}…`;
}

function splitRows(
	windows: WindowInfo[],
	widths: number[],
	maxWidth: number,
): WindowInfo[][] {
	const rows: WindowInfo[][] = [];
	let row: WindowInfo[] = [];
	let rowWidth = 0;
	windows.forEach((window, index) => {
		const width = widths[index];
		const nextWidth = rowWidth > 0 ? width + buttonSpacing : width;
		if (rowWidth + nextWidth <= maxWidth) {
			row.push(window);
			rowWidth += nextWidth;
			return;
		}
		if (row.length > 0) rows.push(row);
		row = [window];
		rowWidth = width;
	});
	if (row.length > 0) rows.push(row);
	return rows;
}

function getMonitorWidth(): number {
	try {
		const display = Gdk.Display.get_default();
		const seat = display?.get_default_seat();
		const pointer = seat?.get_pointer() as unknown as {
			get_position?: () => [unknown, number, number];
		} | null;
		if (!display || !pointer?.get_position) return 1920;
		const [, x, y] = pointer.get_position();
		const monitor = display.get_monitor_at_point(x, y);
		if (!monitor) {
			debugWriteFile(monitorDebugPath, `No monitor at point ${x},${y}\n`);
			return 1920;
		}
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
