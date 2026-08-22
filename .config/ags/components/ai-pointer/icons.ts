import Cairo from "cairo";
import Gtk from "gi://Gtk?version=4.0";

export function createSendIcon(): Gtk.DrawingArea {
	const icon = new Gtk.DrawingArea({ widthRequest: 15, heightRequest: 15 });
	icon.add_css_class("ai-pointer-send-icon");
	icon.set_draw_func((area, cr: any) => {
		setIconStroke(area, cr);
		cr.translate((area.get_width() - 15) / 2, (area.get_height() - 15) / 2);
		cr.moveTo(3, 7.5);
		cr.lineTo(11, 7.5);
		cr.moveTo(7.75, 3.75);
		cr.lineTo(11.5, 7.5);
		cr.lineTo(7.75, 11.25);
		cr.stroke();
	});
	return icon;
}

export function createCloseIcon(): Gtk.DrawingArea {
	const icon = new Gtk.DrawingArea({ widthRequest: 13, heightRequest: 13 });
	icon.add_css_class("ai-pointer-cancel-icon");
	icon.set_draw_func((area, cr: any) => {
		setIconStroke(area, cr);
		cr.translate((area.get_width() - 13) / 2, (area.get_height() - 13) / 2);
		cr.moveTo(3, 3);
		cr.lineTo(10, 10);
		cr.moveTo(10, 3);
		cr.lineTo(3, 10);
		cr.stroke();
	});
	return icon;
}

function setIconStroke(area: Gtk.DrawingArea, cr: any): void {
	const color = area.get_style_context().get_color();
	cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
	cr.setLineWidth(1.5);
	cr.setLineCap(Cairo.LineCap.ROUND);
	cr.setLineJoin(Cairo.LineJoin.ROUND);
}
