import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { PreviewCache } from "../../../components/window-switcher/preview-cache";
import { assert, test } from "./harness";

test("Window Switcher decodes and caches preview textures", () => {
  const fixturePath = `${GLib.get_tmp_dir()}/ags-window-switcher-preview-${GLib.get_monotonic_time()}.jpg`;

  const fixture = GdkPixbuf.Pixbuf.new(
    GdkPixbuf.Colorspace.RGB,
    false,
    8,
    4,
    2,
  );
  assert(fixture !== null, "failed to create preview fixture");
  fixture.fill(0x336699ff);
  fixture.savev(fixturePath, "jpeg", [], []);

  try {
    const cache = new PreviewCache(() => {});
    const decoded = cache.getInfo(fixturePath);
    assert(decoded.texture !== undefined, "decoded preview has no texture");
    assert(
      decoded.width > 0 && decoded.height > 0,
      "decoded preview has invalid dimensions",
    );

    const cached = cache.getInfo(fixturePath);
    assert(cached.texture !== undefined, "cached preview has no texture");
    assert(cached === decoded, "second preview read did not use the cache");
  } finally {
    GLib.unlink(fixturePath);
  }
});
