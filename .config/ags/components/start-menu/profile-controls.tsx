import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import {
	hasAutomaticGamingClaim,
	type ProfileSelection,
	type ProfileState,
} from "../../services/profile-state";

interface ProfileControlsActions {
	onSelect: (selection: ProfileSelection) => void;
	onButtonCreated: (id: string, button: Gtk.Button) => void;
}

export class ProfileControls {
	#box: Gtk.Box | null = null;
	#buttons = new Map<string, Gtk.Button>();
	#badges = new Map<string, Gtk.Box>();

	constructor(private readonly actions: ProfileControlsActions) {}

	create(state: ProfileState | null): Gtk.Box {
		this.#buttons.clear();
		this.#badges.clear();
		const automaticGamingActive = hasAutomaticGamingClaim(state);
		this.#box = (
			<box
				orientation={Gtk.Orientation.VERTICAL}
				spacing={4}
				halign={Gtk.Align.CENTER}
				widthRequest={224}
				class="profile-row"
			>
				<box orientation={Gtk.Orientation.HORIZONTAL} class="profile-actions">
					{this.#createToggle(
						"profile-auto",
						"\uF8B0",
						"auto",
						Gtk.Align.START,
						automaticGamingActive
							? "Automatic profile rules; Game Mode is active"
							: "Use automatic profile rules",
						state,
						automaticGamingActive,
					)}
					<box hexpand={true} />
					{this.#createToggle(
						"profile-default",
						"\uEC49",
						"default",
						Gtk.Align.CENTER,
						"Force Default profile",
						state,
					)}
					<box hexpand={true} />
					{this.#createToggle(
						"profile-gaming",
						"\u{F02B4}",
						"gaming",
						Gtk.Align.CENTER,
						"Force Gaming profile",
						state,
					)}
					<box hexpand={true} />
					{this.#createToggle(
						"profile-powersave",
						"\uEA95",
						"powersave",
						Gtk.Align.END,
						"Force Power Saver profile",
						state,
					)}
				</box>
				<box orientation={Gtk.Orientation.HORIZONTAL} class="profile-labels">
					{profileLabel("Auto")}
					<box hexpand={true} />
					{profileLabel("Default")}
					<box hexpand={true} />
					{profileLabel("Gaming")}
					<box hexpand={true} />
					{profileLabel("Saver")}
				</box>
			</box>
		) as Gtk.Box;
		this.update(state);
		return this.#box;
	}

	update(state: ProfileState | null): void {
		for (const [selection, id] of [
			["auto", "profile-auto"],
			["default", "profile-default"],
			["gaming", "profile-gaming"],
			["powersave", "profile-powersave"],
		] as const) {
			const button = this.#buttons.get(id);
			if (state?.selection === selection) button?.add_css_class("profile-active");
			else button?.remove_css_class("profile-active");
		}
		const automaticGamingActive = hasAutomaticGamingClaim(state);
		this.#badges
			.get("profile-auto")
			?.set_visible(automaticGamingActive && state?.selection === "auto");
		this.#buttons
			.get("profile-auto")
			?.set_tooltip_text(
				automaticGamingActive
					? "Use automatic profile rules; Game Mode is active"
					: "Use automatic profile rules",
			);
		this.#buttons
			.get("profile-default")
			?.set_tooltip_text(
				automaticGamingActive
					? "Force Default profile; Game Mode condition remains active"
					: "Force Default profile",
			);
		this.#buttons
			.get("profile-powersave")
			?.set_tooltip_text(
				automaticGamingActive
					? "Force Power Saver; Game Mode condition remains active"
					: "Force Power Saver profile",
			);
		this.#box?.set_tooltip_text(profileTooltip(state));
	}

	#createToggle(
		id: string,
		icon: string,
		selection: ProfileSelection,
		halign: Gtk.Align,
		tooltip: string,
		state: ProfileState | null,
		badgeVisible = false,
	): Gtk.Button {
		return (
			<button
				canFocus={true}
				halign={halign}
				class={`profile-toggle ${state?.selection === selection ? "profile-active" : ""}`}
				onClicked={() => this.actions.onSelect(selection)}
				$={(button: Gtk.Button) => {
					button.set_cursor_from_name("pointer");
					button.set_tooltip_text(tooltip);
					this.#buttons.set(id, button);
					this.actions.onButtonCreated(id, button);
				}}
			>
				<overlay>
					<label
						label={icon}
						class={`profile-toggle-icon profile-${selection}-icon`}
					/>
					<box
						$type="overlay"
						class="profile-auto-badge"
						halign={Gtk.Align.END}
						valign={Gtk.Align.END}
						widthRequest={14}
						heightRequest={14}
						visible={badgeVisible}
						$={(badge: Gtk.Box) => this.#badges.set(id, badge)}
					>
						<label
							label={"\u{F02B4}"}
							class="profile-auto-badge-icon"
							halign={Gtk.Align.CENTER}
							valign={Gtk.Align.CENTER}
							hexpand={true}
							vexpand={true}
						/>
					</box>
				</overlay>
			</button>
		) as Gtk.Button;
	}
}

export function runProfileSelection(selection: ProfileSelection): void {
	const profilectl = `${GLib.get_home_dir()}/.config/hypr/runtime/profiles/profilectl.sh`;
	const command =
		selection === "auto"
			? `${profilectl} clear-manual`
			: `${profilectl} set-manual ${selection}`;
	try {
		GLib.spawn_command_line_async(command);
	} catch (error) {
		console.error("Failed to update profile:", error);
	}
}

function profileLabel(label: string): Gtk.Overlay {
	return (
		<overlay widthRequest={32} heightRequest={18}>
			<box />
			<label
				$type="overlay"
				label={label}
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
			/>
		</overlay>
	) as Gtk.Overlay;
}

function profileTooltip(state: ProfileState | null): string {
	if (state === null) return "Profile state unavailable";
	const mode =
		state.resolved === "gaming"
			? "Gaming"
			: state.resolved === "powersave"
				? "Saver"
				: state.resolved === "default"
					? "Balanced"
					: "Unavailable";
	return [
		`Profile: ${mode} · ${state.selection === "auto" ? "Auto" : "Manual"}`,
		`Gaming: ${claimsLabel(state.sources.gaming)}`,
		`Powersave: ${claimsLabel(state.sources.powersave)}`,
	].join("\n");
}

function claimsLabel(claims: Record<string, number>): string {
	const entries = Object.entries(claims);
	return entries.length === 0
		? "none"
		: entries.map(([source, count]) => `${source}=${count}`).join(" ");
}
