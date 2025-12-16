import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./Tag";

const meta: Meta<typeof Tag> = {
  title: "Components/Tag",
  component: Tag,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tag>;

/**
 * Default gray tag
 */
export const Default: Story = {
  args: {
    variant: "default",
    children: "5",
  },
};

/**
 * Primary blue tag
 */
export const Primary: Story = {
  args: {
    variant: "primary",
    children: "12",
  },
};

/**
 * Success green tag
 */
export const Success: Story = {
  args: {
    variant: "success",
    children: "3",
  },
};

/**
 * Warning orange tag
 */
export const Warning: Story = {
  args: {
    variant: "warning",
    children: "8",
  },
};

/**
 * Danger red tag (for notifications/updates)
 */
export const Danger: Story = {
  args: {
    variant: "danger",
    children: "99+",
  },
};

/**
 * Single digit
 */
export const SingleDigit: Story = {
  args: {
    variant: "danger",
    children: "1",
  },
};

/**
 * Text label
 */
export const TextLabel: Story = {
  args: {
    variant: "primary",
    children: "New",
  },
};

/**
 * Tag with icon - Download
 */
export const WithIconDownload: Story = {
  args: {
    variant: "primary",
    icon: "\uE895", // Download icon
    children: "5",
  },
};

/**
 * Tag with icon - Warning
 */
export const WithIconWarning: Story = {
  args: {
    variant: "warning",
    icon: "\uE7BA", // Warning icon
    children: "3",
  },
};

/**
 * Tag with icon - Success
 */
export const WithIconSuccess: Story = {
  args: {
    variant: "success",
    icon: "\uE73E", // Checkmark icon
    children: "Done",
  },
};
