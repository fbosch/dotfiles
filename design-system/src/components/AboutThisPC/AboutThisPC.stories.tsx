import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Desktop } from '../Desktop';
import { AboutThisPC } from './AboutThisPC';

const meta: Meta<typeof AboutThisPC> = {
  title: 'Components/AboutThisPC',
  component: AboutThisPC,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop minHeight="100vh">
        <Story />
      </Desktop>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AboutThisPC>;

export const Default: Story = {
  args: {
    isOpen: true,
    info: {
      deviceName: 'NixOS Workstation',
      manufacturer: 'Framework',
      processor: 'AMD Ryzen 7 7840U',
      memory: '32 GB',
      desktop: 'Hyprland',
      operatingSystem: 'NixOS 25.05',
    },
    onClose: fn(),
    onMoreInfo: fn(),
  },
};

export const WithAvailableDetails: Story = {
  args: {
    isOpen: true,
    info: {
      deviceName: 'NixOS Workstation',
      operatingSystem: 'NixOS 25.05',
    },
    onClose: fn(),
  },
};
