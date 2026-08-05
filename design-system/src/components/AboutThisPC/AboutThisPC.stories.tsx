import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
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
      processorClock: '3.3 GHz',
      graphics: 'AMD Radeon 780M',
      memory: '32 GB',
      memoryClock: '3200 MHz',
      desktop: 'Hyprland',
      operatingSystem: 'NixOS 25.05',
      operatingSystemCodename: 'Warbler',
      kernel: 'Linux 6.12.28',
      uptime: '3 hours, 18 minutes',
      deviceIcon: '\uE7F8',
    },
    onClose: fn(),
    onMoreInfo: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'More Info...' }));
    await expect(args.onMoreInfo).toHaveBeenCalledOnce();
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
