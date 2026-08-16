import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import { createRoot } from "ags";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { bindGamingOpacity } from "@/services/gaming-opacity";
import {
	configureButton,
	setButtonVariant,
	type ButtonVariant,
} from "@/components/button";
import type { ConfirmConfig } from "./request";

export interface ConfirmDialogViewHandlers {
	onCancel(): void;
	onConfirm(): void;
}

const variants = ["danger", "warning", "info", "suspend"] as const;

function buttonVariantFor(variant: ConfirmConfig["variant"]): ButtonVariant {
	return variant === "info" ? "primary" : variant;
}

export class ConfirmDialogView {
	#win: Astal.Window | null = null;
	#icon: Gtk.Label | null = null;
	#title: Gtk.Label | null = null;
	#message: Gtk.Label | null = null;
	#cancelButton: Gtk.Button | null = null;
	#confirmButton: Gtk.Button | null = null;
	#handlers: ConfirmDialogViewHandlers | null = null;

	get isCreated(): boolean {
		return this.#win !== null;
	}

	create(handlers: ConfirmDialogViewHandlers): void {
		if (this.#win) return;
		this.#handlers = handlers;
		createRoot((dispose) => {
			this.#win = (
			<window
				name="confirm-dialog"
				namespace="ags-confirm"
				visible={false}
				anchor={Astal.WindowAnchor.NONE}
				layer={Astal.Layer.OVERLAY}
				exclusivity={Astal.Exclusivity.EXCLUSIVE}
				keymode={Astal.Keymode.EXCLUSIVE}
				class="confirm-dialog"
				application={app}
				$={(self: Astal.Window) => {
					bindGamingOpacity(self);
					const keyController = new Gtk.EventControllerKey();
					keyController.connect("key-pressed", (_controller, keyval: number) => {
						if (keyval !== Gdk.KEY_Escape) return false;
						this.#handlers?.onCancel();
						return true;
					});
					self.add_controller(keyController);
				}}
			>
				<box orientation={Gtk.Orientation.VERTICAL} spacing={0} class="dialog-box">
					<box
						orientation={Gtk.Orientation.VERTICAL}
						spacing={0}
						halign={Gtk.Align.CENTER}
						class="content-box"
					>
						<label
							label=""
							halign={Gtk.Align.CENTER}
							class="dialog-icon"
							$={(self: Gtk.Label) => {
								this.#icon = self;
							}}
						/>
						<label
							label=""
							halign={Gtk.Align.CENTER}
							class="dialog-title"
							$={(self: Gtk.Label) => {
								this.#title = self;
							}}
						/>
						<label
							label=""
							halign={Gtk.Align.CENTER}
							class="dialog-message"
							$={(self: Gtk.Label) => {
								this.#message = self;
							}}
						/>
					</box>
					<box orientation={Gtk.Orientation.HORIZONTAL} spacing={8} homogeneous={true}>
						<button
							canFocus={true}
							hexpand={true}
							halign={Gtk.Align.FILL}
							class="dialog-button cancel"
							onClicked={() => this.#handlers?.onCancel()}
							$={(self: Gtk.Button) => {
								this.#cancelButton = self;
								configureButton(self, { variant: "default" });
							}}
						>
							<label label="Cancel" />
						</button>
						<button
							canFocus={true}
							hexpand={true}
							halign={Gtk.Align.FILL}
							class="dialog-button confirm"
							onClicked={() => this.#handlers?.onConfirm()}
							$={(self: Gtk.Button) => {
								this.#confirmButton = self;
								configureButton(self, { variant: "danger" });
							}}
						>
							<label label="Confirm" />
						</button>
					</box>
				</box>
			</window>
			) as Astal.Window;
			this.#win.connect("destroy", dispose);
		});
	}

	setConfig(config: ConfirmConfig): void {
		this.#message?.remove_css_class("operation-error");
		this.#icon?.set_label(config.icon);
		this.#title?.set_label(config.title);
		this.#message?.set_label(config.message);
		(this.#cancelButton?.get_child() as Gtk.Label | null)?.set_label(
			config.cancelLabel,
		);
		(this.#confirmButton?.get_child() as Gtk.Label | null)?.set_label(
			config.confirmLabel,
		);
		for (const variant of variants)
			this.#setCssClass(this.#win, `variant-${variant}`, config.variant === variant);
		if (this.#confirmButton)
			setButtonVariant(this.#confirmButton, buttonVariantFor(config.variant));
	}

	showOperationError(): void {
		this.#message?.set_label("The operation could not be started.");
		this.#message?.add_css_class("operation-error");
	}

	show(): void {
		this.#win?.set_visible(true);
		this.#cancelButton?.grab_focus();
	}

	hide(): void {
		this.#win?.set_visible(false);
	}

	dispose(): void {
		this.#win?.destroy();
		this.#win = null;
		this.#icon = null;
		this.#title = null;
		this.#message = null;
		this.#cancelButton = null;
		this.#confirmButton = null;
		this.#handlers = null;
	}

	#setCssClass(
		widget: Gtk.Widget | null,
		className: string,
		enabled: boolean,
	): void {
		if (!widget) return;
		if (enabled) widget.add_css_class(className);
		else widget.remove_css_class(className);
	}
}
