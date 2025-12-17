import type { Meta, StoryObj } from "@storybook/react-vite";
import { Desktop } from "../Desktop";
import { VolumeChangeIndicator } from "./VolumeChangeIndicator";

const meta: Meta<typeof VolumeChangeIndicator> = {
  title: "Components/VolumeChangeIndicator",
  component: VolumeChangeIndicator,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    volume: {
      control: { type: "range", min: 0, max: 100, step: 1 },
    },
    muted: {
      control: "boolean",
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
type Story = StoryObj<typeof VolumeChangeIndicator>;

export const Default: Story = {
  args: {
    volume: 65,
    muted: false,
  },
};
