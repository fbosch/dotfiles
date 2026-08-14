import app from "ags/gtk4/app";
import { createRoot } from "ags";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import type {
	ProfileSelection,
	ProfileState,
} from "../../services/profile-state";
import { getPointerMonitor } from "../../services/pointer-monitor";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { defaultMenuItems, type MenuItem } from "./menu-model";
import { ProfileControls } from "./profile-controls";
import {
	createRecentItemsMenu,
	type RecentItemsMenuModel,
} from "./recent-items-menu";
import { createUserProfile } from "./user-profile";
import {
	formatTimeSince,
	type UpdatesSnapshot,
} from "./updates-policy";

interface StartMenuViewModel {
	profileState: ProfileState | null;
	updates: UpdatesSnapshot;
}

interface StartMenuViewActions {
	getModel: () => StartMenuViewModel;
	getRecentItems: () => RecentItemsMenuModel;
	onMenuAction: (itemId: string) => void;
	onProfileSelect: (selection: ProfileSelection) => void;
	onHide: () => void;
	onRecentOpenRequest: () => void;
	onRecentCloseRequest: () => void;
	onRecentOpenNow: () => void;
	onRecentCloseNow: () => void;
	onRecentApplication: (id: string) => void;
	onRecentDocument: (uri: string) => void;
	onClearRecentItems: () => void;
	isMenuVisible: () => boolean;
	isRecentItemsVisible: () => boolean;
}

const recentItemsGap = 8;

export class StartMenuView {
	#win: Astal.Window | null = null;
	#menuBox: Gtk.Box | null = null;
	#recentItemsHost: Gtk.Box | null = null;
	#recentItemsRendered = false;
	#windowDispose: (() => void) | null = null;
	#menuRenderDispose: (() => void) | null = null;
	#recentRenderDispose: (() => void) | null = null;
	#updatesRenderDispose: (() => void) | null = null;
	#updatesBadgeHost: Gtk.Box | null = null;
	#updatesButton: Gtk.Button | null = null;
	#menuItemButtons = new Map<string, Gtk.Button>();
	#recentItemButtons: Gtk.Button[] = [];
	#profileControls: ProfileControls;

	constructor(private readonly actions: StartMenuViewActions) {
		this.#profileControls = new ProfileControls({
			onSelect: actions.onProfileSelect,
			onButtonCreated: (id, button) => this.#menuItemButtons.set(id, button),
		});
	}

	get isCreated(): boolean {
		return this.#win !== null;
	}

	get recentItemsRendered(): boolean {
		return this.#recentItemsRendered;
	}

	create(): void {
		if (this.#win) return;
		createRoot((dispose) => {
			this.#windowDispose = dispose;
			this.#win = (
			<window
				name="start-menu"
				namespace="ags-start-menu"
				visible={false}
				anchor={
					Astal.WindowAnchor.TOP |
					Astal.WindowAnchor.BOTTOM |
					Astal.WindowAnchor.LEFT |
					Astal.WindowAnchor.RIGHT
				}
				layer={Astal.Layer.OVERLAY}
				exclusivity={Astal.Exclusivity.IGNORE}
				keymode={Astal.Keymode.ON_DEMAND}
				application={app}
				class="start-menu"
				$={(window: Astal.Window) => {
					bindGamingOpacity(window);
					const keys = new Gtk.EventControllerKey();
					keys.connect("key-pressed", (_controller, keyval) =>
						this.#handleKeyboardNavigation(keyval),
					);
					window.add_controller(keys);
					const clicks = new Gtk.GestureClick();
					clicks.connect("released", (_controller, _presses, x, y) =>
						this.#handleOutsideClick(x, y),
					);
					window.add_controller(clicks);
				}}
			>
				<box
					orientation={Gtk.Orientation.VERTICAL}
					valign={Gtk.Align.END}
					halign={Gtk.Align.START}
				>
					<box
						orientation={Gtk.Orientation.VERTICAL}
						class="start-menu-container"
						$={(box: Gtk.Box) => {
							this.#menuBox = box;
							this.render();
						}}
					/>
				</box>
			</window>
			) as Astal.Window;
		});
	}

	show(): void {
		this.create();
		if (!this.#win) return;
		try {
			const pointerMonitor = getPointerMonitor();
			if (pointerMonitor) this.#win.set_gdkmonitor(pointerMonitor.monitor);
		} catch (error) {
			console.error("Failed to resolve Start Menu trigger monitor:", error);
		}
		this.#win.set_visible(true);
		if (this.#win.get_focus()) this.#win.set_focus(null);
		for (const button of this.#menuItemButtons.values()) {
			button.remove_css_class("focused");
			button.get_style_context().remove_class("focused");
		}
	}

	hide(): void {
		this.#win?.set_visible(false);
		if (this.#win?.get_focus()) this.#win.set_focus(null);
	}

	render(): void {
		if (!this.#menuBox) return;
		this.actions.onRecentCloseNow();
		this.#updatesRenderDispose?.();
		this.#updatesRenderDispose = null;
		this.#menuRenderDispose?.();
		this.#menuRenderDispose = null;
		clearChildren(this.#menuBox);
		this.#menuItemButtons.clear();
		this.#recentItemsHost = null;
		this.#updatesBadgeHost = null;
		this.#updatesButton = null;
		createRoot((dispose) => {
			this.#menuRenderDispose = dispose;
			this.#menuBox?.append(createUserProfile());
			this.#menuBox?.append(createDivider());
			for (const item of defaultMenuItems) {
				if (item.id.startsWith("divider")) this.#menuBox?.append(createDivider());
				else if (item.id === "profile-controls")
					this.#menuBox?.append(
						this.#profileControls.create(this.actions.getModel().profileState),
					);
				else this.#menuBox?.append(this.#createMenuItem(item));
			}
		});
		this.updateUpdates(this.actions.getModel().updates);
	}

	updateProfile(state: ProfileState | null): void {
		this.#profileControls.update(state);
	}

	updateUpdates(updates: UpdatesSnapshot): void {
		if (!this.#updatesBadgeHost || !this.#updatesButton) return;
		this.#updatesRenderDispose?.();
		this.#updatesRenderDispose = null;
		clearChildren(this.#updatesBadgeHost);
		const tooltip = updatesTooltip(updates);
		this.#updatesButton.set_tooltip_text(tooltip || null);
		const { flake, flatpak } = updates;
		const badges: Gtk.Widget[] = [];
		createRoot((dispose) => {
			this.#updatesRenderDispose = dispose;
			if (flake && flake.count > 0)
				badges.push(
					updateBadge("\uE843", flake.count, "updates-badge-nix-icon") as Gtk.Widget,
				);
			if (flatpak && flatpak.count > 0)
				badges.push(updateBadge("\uF1B2", flatpak.count) as Gtk.Widget);
			for (const badge of badges) this.#updatesBadgeHost?.append(badge);
		});
		this.#updatesBadgeHost.set_visible(badges.length > 0);
	}

	renderRecentItems(): void {
		if (!this.#recentItemsHost) return;
		this.#recentRenderDispose?.();
		this.#recentRenderDispose = null;
		this.#recentItemButtons.length = 0;
		clearChildren(this.#recentItemsHost);
		createRoot((dispose) => {
			this.#recentRenderDispose = dispose;
			this.#recentItemsHost?.append(
				createRecentItemsMenu(this.actions.getRecentItems(), {
					onApplicationActivated: ({ id }) =>
						this.actions.onRecentApplication(id),
					onDocumentActivated: ({ id }) => this.actions.onRecentDocument(id),
					onClearRecentItems: this.actions.onClearRecentItems,
					onButtonCreated: (button) => this.#recentItemButtons.push(button),
				}),
			);
		});
		this.#positionRecentItems();
		this.#recentItemsHost.set_visible(true);
		this.#recentItemsRendered = true;
		this.#menuItemButtons.get("recent-items")?.add_css_class("submenu-open");
	}

	concealRecentItems(): void {
		this.#recentRenderDispose?.();
		this.#recentRenderDispose = null;
		this.#recentItemsRendered = false;
		this.#recentItemsHost?.set_visible(false);
		this.#recentItemButtons.length = 0;
		this.#menuItemButtons.get("recent-items")?.remove_css_class("submenu-open");
	}

	dispose(): void {
		this.#recentRenderDispose?.();
		this.#updatesRenderDispose?.();
		this.#menuRenderDispose?.();
		this.#windowDispose?.();
		this.#recentRenderDispose = null;
		this.#updatesRenderDispose = null;
		this.#menuRenderDispose = null;
		this.#windowDispose = null;
		this.#win = null;
		this.#menuBox = null;
		this.#recentItemsHost = null;
		this.#updatesBadgeHost = null;
		this.#updatesButton = null;
		this.#menuItemButtons.clear();
		this.#recentItemButtons.length = 0;
		this.#recentItemsRendered = false;
	}

	#createMenuItem(item: MenuItem): Gtk.Widget {
		const button = (
			<button
				canFocus={true}
				class={`menu-item menu-variant-${item.variant || "default"}`}
				onClicked={() => this.actions.onMenuAction(item.id)}
				$={(self: Gtk.Button) => {
					self.set_cursor_from_name("pointer");
					this.#menuItemButtons.set(item.id, self);
					if (item.id === "recent-items") {
						const motion = new Gtk.EventControllerMotion();
						motion.connect("enter", this.actions.onRecentOpenRequest);
						motion.connect("leave", this.actions.onRecentCloseRequest);
						self.add_controller(motion);
					}
					if (item.id === "system-updates") {
						this.#updatesButton = self;
					}
				}}
			>
				<box
					orientation={Gtk.Orientation.HORIZONTAL}
					spacing={10}
					halign={Gtk.Align.FILL}
					class="menu-item-content"
				>
					<label label={item.icon} class="menu-item-icon" />
					<label
						label={item.label}
						halign={Gtk.Align.START}
						hexpand={true}
						class="menu-item-label"
					/>
					{item.id === "system-updates" ? (
						<box
							orientation={Gtk.Orientation.HORIZONTAL}
							spacing={4}
							halign={Gtk.Align.END}
							valign={Gtk.Align.CENTER}
							visible={false}
							class="updates-badges"
							$={(host: Gtk.Box) => {
								this.#updatesBadgeHost = host;
							}}
						/>
					) : null}
					{item.id === "recent-items" ? (
						<label label={"\uE76C"} class="menu-item-chevron" />
					) : null}
				</box>
			</button>
		) as Gtk.Button;
		if (item.id !== "recent-items") return button;
		return (
			<overlay>
				{button}
				<box
					$type="overlay"
					orientation={Gtk.Orientation.VERTICAL}
					halign={Gtk.Align.START}
					valign={Gtk.Align.END}
					visible={false}
					class="recent-items-host"
					$={(host: Gtk.Box) => {
						this.#recentItemsHost = host;
						const motion = new Gtk.EventControllerMotion();
						motion.connect("enter", this.actions.onRecentOpenRequest);
						motion.connect("leave", this.actions.onRecentCloseRequest);
						host.add_controller(motion);
					}}
				/>
			</overlay>
		) as Gtk.Overlay;
	}

	#positionRecentItems(): void {
		if (!this.#win || !this.#recentItemsHost) return;
		const trigger = this.#menuItemButtons.get("recent-items");
		if (!trigger) return;
		this.#recentItemsHost.set_margin_start(0);
		this.#recentItemsHost.set_margin_end(0);
		const [hasBounds, bounds] = trigger.compute_bounds(this.#win);
		if (!hasBounds) {
			this.#recentItemsHost.set_halign(Gtk.Align.START);
			this.#recentItemsHost.set_margin_start(trigger.get_width() + recentItemsGap);
			return;
		}
		const [, submenuWidth] = this.#recentItemsHost.measure(
			Gtk.Orientation.HORIZONTAL,
			-1,
		);
		const workAreaWidth =
			this.#win.get_width() ||
			this.#win.get_gdkmonitor()?.get_geometry().width ||
			Number.MAX_SAFE_INTEGER;
		const triggerWidth = Math.ceil(bounds.get_width());
		const triggerRight = Math.ceil(bounds.get_x()) + triggerWidth;
		const opensRight =
			triggerRight + recentItemsGap + submenuWidth <= workAreaWidth;
		this.#recentItemsHost.set_halign(opensRight ? Gtk.Align.START : Gtk.Align.END);
		if (opensRight)
			this.#recentItemsHost.set_margin_start(triggerWidth + recentItemsGap);
		else this.#recentItemsHost.set_margin_end(triggerWidth + recentItemsGap);
	}

	#handleKeyboardNavigation(keyval: number): boolean {
		const focused = this.#win?.get_focus() ?? null;
		const recentIndex = this.#recentItemButtons.findIndex(
			(button) => button === focused,
		);
		if (
			this.actions.isRecentItemsVisible() &&
			(keyval === Gdk.KEY_Escape || keyval === Gdk.KEY_Left)
		) {
			this.actions.onRecentCloseNow();
			this.#menuItemButtons.get("recent-items")?.grab_focus();
			return true;
		}
		if (this.actions.isRecentItemsVisible() && recentIndex >= 0) {
			if (keyval === Gdk.KEY_Down || keyval === Gdk.KEY_Tab) {
				this.#recentItemButtons[(recentIndex + 1) % this.#recentItemButtons.length]?.grab_focus();
				return true;
			}
			if (keyval === Gdk.KEY_Up || keyval === Gdk.KEY_ISO_Left_Tab) {
				const previous =
					recentIndex === 0 ? this.#recentItemButtons.length - 1 : recentIndex - 1;
				this.#recentItemButtons[previous]?.grab_focus();
				return true;
			}
			if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space) {
				this.#recentItemButtons[recentIndex]?.activate();
				return true;
			}
		}
		if (keyval === Gdk.KEY_Escape) {
			this.actions.onHide();
			return true;
		}
		const buttons = Array.from(this.#menuItemButtons.values()).filter(
			(button) => button.can_focus,
		);
		if (buttons.length === 0) return false;
		const current = buttons.find((button) => button.has_focus);
		const index = current ? buttons.indexOf(current) : -1;
		if (keyval === Gdk.KEY_Right && current === this.#menuItemButtons.get("recent-items")) {
			this.actions.onRecentOpenNow();
			this.#recentItemButtons[0]?.grab_focus();
			return true;
		}
		if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_Down) {
			buttons[(index + 1) % buttons.length]?.grab_focus();
			return true;
		}
		if (keyval === Gdk.KEY_ISO_Left_Tab || keyval === Gdk.KEY_Up) {
			buttons[index <= 0 ? buttons.length - 1 : index - 1]?.grab_focus();
			return true;
		}
		if ((keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space) && current) {
			current.activate();
			return true;
		}
		return false;
	}

	#handleOutsideClick(x: number, y: number): void {
		if (!this.actions.isMenuVisible() || !this.#win) return;
		const target = this.#win.pick(x, y, Gtk.PickFlags.DEFAULT);
		if (
			this.#menuBox &&
			(target === this.#menuBox || target?.is_ancestor(this.#menuBox) === true)
		)
			return;
		if (
			this.actions.isRecentItemsVisible() &&
			this.#recentItemsHost &&
			(target === this.#recentItemsHost ||
				target?.is_ancestor(this.#recentItemsHost) === true)
		)
			return;
		this.actions.onHide();
	}
}

function clearChildren(container: Gtk.Box): void {
	let child = container.get_first_child();
	while (child) {
		container.remove(child);
		child = container.get_first_child();
	}
}

function createDivider(): Gtk.Separator {
	const separator = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL });
	separator.add_css_class("menu-divider");
	return separator;
}

function updateBadge(icon: string, count: number, extraClass = ""): JSX.Element {
	return (
		<box
			orientation={Gtk.Orientation.HORIZONTAL}
			spacing={4}
			halign={Gtk.Align.CENTER}
			valign={Gtk.Align.CENTER}
			class="updates-badge"
		>
			<label
				label={icon}
				class={`updates-badge-icon ${extraClass}`}
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
			/>
			<label
				label={count.toString()}
				class="updates-badge-count"
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
			/>
		</box>
	);
}

function updatesTooltip({ flake, flatpak }: UpdatesSnapshot): string {
	const parts: string[] = [];
	if (flake && flake.count > 0) {
		const checked = formatTimeSince(flake.timestamp);
		const updates = flake.updates
			.map((update) => `• ${update.name}: ${update.currentShort} → ${update.newShort}`)
			.join("\n");
		parts.push(
			updates
				? `NixOS Updates${checked ? ` (checked ${checked})` : ""}:\n${updates}`
				: `${flake.count} NixOS update${flake.count === 1 ? "" : "s"} available`,
		);
	}
	if (flatpak && flatpak.count > 0) {
		const checked = formatTimeSince(flatpak.timestamp);
		const updates = flatpak.updates
			.map((update) => `• ${update.app}: ${update.currentVersion} → ${update.newVersion}`)
			.join("\n");
		parts.push(
			updates
				? `Flatpak Updates${checked ? ` (checked ${checked})` : ""}:\n${updates}`
				: `${flatpak.count} Flatpak update${flatpak.count === 1 ? "" : "s"} available`,
		);
	}
	return parts.join("\n\n");
}
