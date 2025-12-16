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
