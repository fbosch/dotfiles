import type { Meta, StoryObj } from '@storybook/react';
import { Waybar } from './Waybar';

const meta: Meta<typeof Waybar> = {
  title: 'Components/Waybar',
  component: Waybar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    position: {
      control: 'radio',
      options: ['top', 'bottom'],
      description: 'Position of the waybar',
    },
    height: {
      control: { type: 'range', min: 30, max: 80, step: 5 },
      description: 'Height of the waybar in pixels',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Waybar>;

export const Bottom: Story = {
  args: {
    position: 'bottom',
    height: 45,
  },
};

export const Top: Story = {
  args: {
    position: 'top',
    height: 45,
  },
};

export const Tall: Story = {
  args: {
    position: 'bottom',
    height: 60,
  },
};

export const Compact: Story = {
  args: {
    position: 'bottom',
    height: 35,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-8 p-8 bg-background-primary min-h-screen">
      <div>
        <h2 className="text-foreground-primary text-lg font-bold mb-4">Bottom Position</h2>
        <Waybar position="bottom" height={45} />
      </div>
      <div>
        <h2 className="text-foreground-primary text-lg font-bold mb-4">Top Position</h2>
        <Waybar position="top" height={45} />
      </div>
      <div>
        <h2 className="text-foreground-primary text-lg font-bold mb-4">Tall (60px)</h2>
        <Waybar position="bottom" height={60} />
      </div>
      <div>
        <h2 className="text-foreground-primary text-lg font-bold mb-4">Compact (35px)</h2>
        <Waybar position="bottom" height={35} />
      </div>
    </div>
  ),
};
