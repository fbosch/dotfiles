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
      <div className="p-4 font-mono text-sm text-foreground-primary bg-background-primary h-full">
        <div className="mb-2">
          <span className="text-state-success">user@hostname</span>
          <span className="text-foreground-secondary"> ~ </span>
        </div>
        <div className="mb-4">$ fastfetch</div>
        <div className="flex gap-8">
          {/* NixOS ASCII Logo */}
          <pre className="text-[#7EBAE4] text-xs font-mono">
            <code>{`                ___   __              
         /¯\\    \\  \\ /  ;             
         \\  \\    \\  v  /              
      /¯¯¯   ¯¯¯¯\\\\   /  /\\           
     '————————————·\\  \\ /  ;          
          /¯¯;      \\ //  /_          
    _____/  /        '/     \\         
    \\      /,        /  /¯¯¯¯         
     ¯¯/  // \\      /__/              
      .  / \\  \\·————————————.         
       \\/  /   \\\\_____   ___/         
          /  ,  \\     \\  \\            
          \\_/ \\__\\     \\_/`}</code>
          </pre>
          {/* System Info */}
          <div className="text-foreground-secondary text-xs space-y-1 flex-1">
            <div>
              <span className="text-state-success font-bold">user</span>
              <span className="text-foreground-primary">@</span>
              <span className="text-state-success font-bold">nixos</span>
            </div>
            <div className="text-foreground-tertiary">-----------------</div>
            <div>
              <span className="text-state-success">OS</span>: NixOS 24.11 (Vicuna)
            </div>
            <div>
              <span className="text-state-success">Host</span>: Hyprland Desktop
            </div>
            <div>
              <span className="text-state-success">Kernel</span>: 6.6.63
            </div>
            <div>
              <span className="text-state-success">Uptime</span>: 2 hours, 34 mins
            </div>
            <div>
              <span className="text-state-success">Packages</span>: 1247 (nix-system), 89 (nix-user)
            </div>
            <div>
              <span className="text-state-success">Shell</span>: fish 3.7.1
            </div>
            <div>
              <span className="text-state-success">WM</span>: Hyprland (Wayland)
            </div>
            <div>
              <span className="text-state-success">Theme</span>: Zenwritten Dark
            </div>
            <div>
              <span className="text-state-success">Terminal</span>: foot
            </div>
            <div>
              <span className="text-state-success">Terminal Font</span>: JetBrains Mono (12pt)
            </div>
            <div>
              <span className="text-state-success">CPU</span>: AMD Ryzen 9 7950X (32) @ 5.88 GHz
            </div>
            <div>
              <span className="text-state-success">GPU</span>: AMD Radeon RX 7900 XTX
            </div>
            <div>
              <span className="text-state-success">Memory</span>: 8.2 GiB / 64 GiB (13%)
            </div>
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

export const WithoutTitlebar: Story = {
  args: {
    state: "active",
    shadow: true,
    showTitlebar: false,
    width: "600px",
    height: "400px",
    children: (
      <div className="p-6 bg-background-primary h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🎵</div>
          <h2 className="text-lg font-bold text-foreground-primary mb-2">
            Now Playing
          </h2>
          <p className="text-sm text-foreground-secondary mb-1">
            Resonance
          </p>
          <p className="text-xs text-foreground-tertiary">
            Home - Odyssey
          </p>
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
