import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Button } from "../Button";
import { Desktop } from "../Desktop";
import { Dialog } from "./Dialog";

const meta: Meta<typeof Dialog> = {
  title: "Components/Dialog",
  component: Dialog,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "danger", "warning"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    centered: {
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
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  args: {
    icon: "",
    title: "Information",
    message: "This is a default dialog message",
    variant: "default",
    size: "md",
  },
};

export const Danger: Story = {
  args: {
    icon: "",
    title: "Are you sure?",
    message: "High-impact operation, please confirm",
    variant: "danger",
    size: "md",
    footer: (
      <>
        <Button variant="default" fullWidth onClick={fn()}>
          Cancel
        </Button>
        <Button variant="danger" fullWidth onClick={fn()}>
          Confirm
        </Button>
      </>
    ),
  },
};

export const Warning: Story = {
  args: {
    icon: "",
    title: "Warning",
    message: "This action may have unintended consequences",
    variant: "warning",
    size: "md",
    footer: (
      <>
        <Button variant="outline" fullWidth onClick={fn()}>
          Cancel
        </Button>
        <Button variant="warning" fullWidth onClick={fn()}>
          Continue
        </Button>
      </>
    ),
  },
};
