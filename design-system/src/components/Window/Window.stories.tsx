import type { Meta, StoryObj } from "@storybook/react-vite";
import { Desktop } from "../Desktop";
import { Window } from "./Window";

const meta: Meta<typeof Window> = {
  title: "Components/Window",
  component: Window,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    state: {
      control: "select",
      options: ["active", "inactive"],
    },
    shadow: {
      control: "boolean",
    },
    showTitlebar: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Window>;

export const Default: Story = {
  args: {
    title: "Terminal - fish",
    state: "active",
    shadow: true,
    showTitlebar: true,
    width: "800px",
    height: "600px",
    onClose: () => console.log("Close clicked"),
    onMaximize: () => console.log("Maximize clicked"),
    onMinimize: () => console.log("Minimize clicked"),
    children: (
      <div className="p-4 font-mono text-sm text-foreground-primary bg-background-primary h-full flex items-center justify-center">
        <div>
          <div className="mb-2">
            <span className="text-state-success">user@hostname</span>
            <span className="text-foreground-secondary"> ~ </span>
          </div>
          <div className="mb-2">$ neofetch</div>
          <div className="text-foreground-secondary text-xs space-y-1 mt-4">
            <div>OS: NixOS 24.11</div>
            <div>WM: Hyprland</div>
            <div>Theme: Zenwritten Dark</div>
            <div>Terminal: Foot</div>
            <div>Shell: Fish</div>
          </div>
        </div>
      </div>
    ),
  },
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop minHeight="100vh" alignItems="center">
        <div className="flex items-center justify-center">
          <Story />
        </div>
      </Desktop>
    ),
  ],
};
