# TSX/JSX Conventions

AGS v3 with Gnim provides JSX support for GTK widgets. Prefer JSX over programmatic widget creation.

## Property names

- Use `class` (not `className`)

```tsx
<box class="my-class">
```

## Common widgets

```tsx
<window
  name="window-name"
  namespace="unique-namespace" // Important for Hyprland layer rules
  visible={true}
  anchor={Astal.WindowAnchor.CENTER}
  layer={Astal.Layer.OVERLAY} // Use enum, not string
  exclusivity={Astal.Exclusivity.EXCLUSIVE}
  keymode={Astal.Keymode.EXCLUSIVE}
  class="window-class"
>
  {/* content */}
</window>

<box orientation="horizontal" spacing={12} halign="center" class="box-class">
  {/* children */}
</box>

<button onClicked={() => {}} class="button-class">
  <label label="Button Text" />
</button>

<label label="Text content" class="label-class" halign="center" />
```

## Capturing widget references with `setup`

```tsx
let myLabel: Gtk.Label | null = null;

<label
  label="Initial text"
  setup={(self: Gtk.Label) => {
    myLabel = self;
  }}
/>

myLabel?.set_label("Updated text");
myLabel?.add_css_class("active");
```

## Dynamic children

```tsx
const items = ["Item 1", "Item 2", "Item 3"];
<box orientation="vertical">
  {items.map(item => <label label={item} />)}
</box>

const squares: JSX.Element[] = [];
for (let i = 0; i < 20; i++) {
  squares.push(<box class={`square-${i}`} />);
}
<box>{squares}</box>
```

## App structure with inline CSS

```tsx
import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";

app.start({
  css: `
    window.my-window {
      background-color: transparent;
    }

    box.my-box {
      padding: 20px;
      background-color: rgb(32, 32, 32);
    }
  `,
  main() {
    return (
      <window name="my-window" class="my-window">
        <box class="my-box">
          <label label="Content" />
        </box>
      </window>
    );
  },
});
```
