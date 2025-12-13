import type { Meta, StoryObj } from '@storybook/react-vite';
import { Waybar } from './Waybar';
import { Desktop } from '../Desktop';

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

export const Default: Story = {
  args: {
    position: 'bottom',
    height: 45,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop>
        <Story />
      </Desktop>
    ),
  ],
};
