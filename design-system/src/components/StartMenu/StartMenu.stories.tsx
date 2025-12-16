import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Desktop } from "../Desktop";
import { Waybar } from "../Waybar/Waybar";
import { StartMenu } from "./StartMenu";

const meta: Meta<typeof StartMenu> = {
  title: "Components/StartMenu",
  component: StartMenu,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof StartMenu>;

/**
 * Interactive demo showing StartMenu spawning from the NixOS logo in Waybar
 */
export const SpawningFromWaybar: Story = {
  render: () => {
    const [isMenuOpen, setIsMenuOpen] = useState(true);

    const handleStartButtonClick = () => {
      setIsMenuOpen(!isMenuOpen);
    };

    const handleMenuClose = () => {
      setIsMenuOpen(false);
    };

    const handleItemClick = (itemId: string) => {
      console.log(`Menu item clicked: ${itemId}`);
    };

    return (
      <Desktop>
        <div className="relative w-full">
          {/* Start Menu - positioned at bottom-left */}
          <StartMenu
            isOpen={isMenuOpen}
            systemUpdatesCount={3}
            onClose={handleMenuClose}
            onItemClick={handleItemClick}
            style={{
              position: "absolute",
              bottom: "53px",
              left: "8px",
            }}
          />

          {/* Waybar with clickable start button */}
          <div className="relative">
            {/* Overlay to make start button clickable */}
            <button
              type="button"
              onClick={handleStartButtonClick}
              className="absolute left-1 top-0 h-full w-12 z-10"
              aria-label="Toggle Start Menu"
              style={{ background: "transparent", border: "none" }}
            />
            <Waybar position="bottom" height={45} />
          </div>
        </div>
      </Desktop>
    );
  },
};

/**
 * Open state demo
 */
export const Open: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="bg-background-primary min-h-screen p-8">
        <Story />
      </div>
    ),
  ],
};

/**
 * Open state with system updates available
 */
export const WithSystemUpdates: Story = {
  args: {
    isOpen: true,
    systemUpdatesCount: 5,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="bg-background-primary min-h-screen p-8">
        <Story />
      </div>
    ),
  ],
};

/**
 * With animations disabled (better performance on slower systems)
 */
export const WithoutAnimations: Story = {
  args: {
    isOpen: true,
    systemUpdatesCount: 3,
    disableAnimations: true,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="bg-background-primary min-h-screen p-8">
        <Story />
      </div>
    ),
  ],
};

/**
 * Purple variant demo - showing the suspend action color
 */
export const PurpleVariant: Story = {
  args: {
    isOpen: true,
    items: [
      {
        id: "system-settings",
        label: "System Settings",
        icon: "\uE713",
        variant: "default",
      },
      {
        id: "suspend",
        label: "Suspend",
        icon: "\uE708",
        variant: "purple",
      },
      {
        id: "restart",
        label: "Restart",
        icon: "\uE777",
        variant: "warning",
      },
      {
        id: "shutdown",
        label: "Shutdown",
        icon: "\uE7E8",
        variant: "danger",
      },
    ],
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="bg-background-primary min-h-screen p-8">
        <Story />
      </div>
    ),
  ],
};
