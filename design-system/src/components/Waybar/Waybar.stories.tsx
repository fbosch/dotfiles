import type { Meta, StoryObj } from '@storybook/react-vite';
import { Desktop } from '../Desktop';
import { Waybar } from './Waybar';

const meta: Meta<typeof Waybar> = {
  title: 'Components/Waybar',
  component: Waybar,
  parameters: {
    layout: 'fullscreen',
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
