// biome-ignore-all lint/a11y/noLabelWithoutControl: GTK labels are text widgets, not HTML form labels.
// biome-ignore-all lint/a11y/useButtonType: Gtk.Button does not expose an HTML button type.
import Gtk from "gi://Gtk?version=4.0";
import type { IconRef } from "../services/app-icons";
import { setImageFile } from "../services/app-icons";

export interface RecentItemsMenuItem {
	id: string;
	label: string;
	detail?: string;
	icon: IconRef | null;
	fallbackLetter: string;
}

export interface RecentItemsMenuModel {
	applications: RecentItemsMenuItem[];
	documents: RecentItemsMenuItem[];
}

function createItemIcon(item: RecentItemsMenuItem): Gtk.Widget {
	const icon = item.icon;
	if (icon?.kind === "theme") {
		return (
			<image iconName={icon.name} pixelSize={18} class="recent-item-icon" />
		) as Gtk.Image;
	}

	if (icon?.kind === "file") {
		return (
			<image
				pixelSize={18}
				class="recent-item-icon"
				$={(self: Gtk.Image) => setImageFile(self, icon.path)}
			/>
		) as Gtk.Image;
	}

	return (
		<box class="recent-item-fallback">
			<label
				label={item.fallbackLetter}
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
			/>
		</box>
	) as Gtk.Box;
}

function createRecentItem(item: RecentItemsMenuItem): Gtk.Button {
	return (
		<button
			sensitive={false}
			canFocus={false}
			class="recent-item"
			tooltipText={item.detail}
		>
			<box orientation={Gtk.Orientation.HORIZONTAL} spacing={10}>
				{createItemIcon(item)}
				<box
					orientation={Gtk.Orientation.VERTICAL}
					halign={Gtk.Align.START}
					valign={Gtk.Align.CENTER}
					hexpand={true}
				>
					<label
						label={item.label}
						xalign={0}
						ellipsize={3}
						maxWidthChars={30}
						class="recent-item-label"
					/>
					{item.detail ? (
						<label
							label={item.detail}
							xalign={0}
							ellipsize={3}
							maxWidthChars={30}
							class="recent-item-detail"
						/>
					) : null}
				</box>
			</box>
		</button>
	) as Gtk.Button;
}

function createSection(title: string, items: RecentItemsMenuItem[]): Gtk.Box {
	return (
		<box orientation={Gtk.Orientation.VERTICAL}>
			<label label={title} xalign={0} class="recent-items-heading" />
			{items.map(createRecentItem)}
		</box>
	) as Gtk.Box;
}

export function createRecentItemsMenu(model: RecentItemsMenuModel): Gtk.Box {
	const hasApplications = model.applications.length > 0;
	const hasDocuments = model.documents.length > 0;
	const hasRecentItems = hasApplications || hasDocuments;

	return (
		<box orientation={Gtk.Orientation.VERTICAL} class="recent-items-menu">
			{hasRecentItems ? (
				<>
					{hasApplications
						? createSection("Applications", model.applications)
						: null}
					{hasApplications && hasDocuments ? (
						<box class="recent-items-divider" />
					) : null}
					{hasDocuments ? createSection("Documents", model.documents) : null}
				</>
			) : (
				<label label="No recent items" class="recent-items-empty" />
			)}
			<box class="recent-items-divider" />
			<button sensitive={false} canFocus={false} class="recent-items-clear">
				<box orientation={Gtk.Orientation.HORIZONTAL} spacing={10}>
					<label label={"\uE74D"} class="recent-items-clear-icon" />
					<label label="Clear Recent Items" />
				</box>
			</button>
		</box>
	) as Gtk.Box;
}
