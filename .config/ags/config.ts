import app from "ags/gtk4/app"
import { Astal } from "ags/gtk4"
import { createBinding } from "ags/binding"
import { Hyprland } from "ags/hyprland"

const { CENTER } = Astal.WindowAnchor
const hyprland = Hyprland.get_default()
const clients = createBinding(hyprland, "clients")

app.start({
  main() {
    return (
      <window name="overview" visible={false} anchor={CENTER}>
        <box vertical>
          <For each={clients}>
            {(client) => (
              <button onClicked={() => hyprland.dispatch("focuswindow", client.address)}>
                <box>
                  <icon icon={client.class} />
                  <label label={client.title} />
                </box>
              </button>
            )}
          </For>
        </box>
      </window>
    )
  },
})