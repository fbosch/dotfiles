import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";

export function createUserProfile(): Gtk.Box {
	const username = GLib.get_real_name() || GLib.get_user_name() || "User";
	const cacheDir = GLib.get_user_cache_dir();
	const avatarPath = findAvatar(cacheDir);
	const avatarSize = 32;

	return (
		<box
			orientation={Gtk.Orientation.HORIZONTAL}
			spacing={14}
			halign={Gtk.Align.FILL}
			class="user-profile"
		>
			<box
				class="user-avatar-image"
				$={(self: Gtk.Box) => {
					self.set_size_request(avatarSize, avatarSize);
					if (
						!avatarPath ||
						!GLib.file_test(avatarPath, GLib.FileTest.EXISTS)
					)
						return;
					const pixbuf = GdkPixbuf.Pixbuf.new_from_file(avatarPath);
					const image = Gtk.Image.new_from_pixbuf(pixbuf);
					image.set_size_request(avatarSize, avatarSize);
					image.set_pixel_size(avatarSize);
					self.append(image);
				}}
			/>
			<label
				label={username}
				halign={Gtk.Align.START}
				valign={Gtk.Align.CENTER}
				hexpand={true}
				class="user-name"
			/>
		</box>
	) as Gtk.Box;
}

function findAvatar(cacheDir: string): string | null {
	try {
		const enumerator = Gio.File.new_for_path(cacheDir).enumerate_children(
			"standard::name",
			Gio.FileQueryInfoFlags.NONE,
			null,
		);
		let fileInfo: Gio.FileInfo | null;
		while ((fileInfo = enumerator.next_file(null)) !== null) {
			const name = fileInfo.get_name();
			if (name.startsWith("ags-avatar-") && name.endsWith(".png"))
				return `${cacheDir}/${name}`;
		}
	} catch (error) {
		console.error("Failed to find avatar:", error);
	}
	return null;
}
