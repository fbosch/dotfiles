import type { Meta, StoryObj } from "@storybook/react-vite";
import { Desktop } from "../Desktop";
import { KeyboardLayoutSwitcher } from "./KeyboardLayoutSwitcher";

const meta: Meta<typeof KeyboardLayoutSwitcher> = {
  title: "Components/KeyboardLayoutSwitcher",
  component: KeyboardLayoutSwitcher,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    fromLayout: {
      control: "text",
    },
    toLayout: {
      control: "text",
    },
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

export default meta;
type Story = StoryObj<typeof KeyboardLayoutSwitcher>;

export const Default: Story = {
  args: {
    fromLayout: "EN",
    toLayout: "DA",
    size: "md",
  },
};

export const Small: Story = {
  args: {
    fromLayout: "US",
    toLayout: "RU",
    size: "sm",
  },
};

export const Large: Story = {
  args: {
    fromLayout: "EN",
    toLayout: "中文",
    size: "lg",
  },
};
