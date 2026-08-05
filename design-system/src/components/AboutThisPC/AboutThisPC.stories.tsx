import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Desktop } from '../Desktop';
import { AboutThisPC } from './AboutThisPC';

const configuredDeviceImage = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#7aa2f7"/>
        <stop offset="1" stop-color="#3d59a1"/>
      </linearGradient>
    </defs>
    <rect x="48" y="18" width="224" height="132" rx="8" fill="#171717"/>
    <rect x="54" y="24" width="212" height="118" rx="4" fill="url(#screen)"/>
    <path d="M34 150h252l18 12c2 2 1 6-3 6H19c-4 0-5-4-3-6l18-12Z" fill="#a3a3a3"/>
    <path d="M119 154h82l-7 7h-68l-7-7Z" fill="#737373"/>
  </svg>
`)}`;

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

export const OptionalInformationOmitted: Story = {
  args: {
    isOpen: true,
    info: {
      deviceName: 'NixOS Workstation',
      operatingSystem: 'NixOS 25.05',
    },
    onClose: fn(),
  },
};

export const ConfiguredDeviceImage: Story = {
  args: {
    isOpen: true,
    info: {
      deviceName: 'NixOS Laptop',
      manufacturer: 'Framework',
      deviceImageSrc: configuredDeviceImage,
      deviceIcon: '\uE7F8',
      processor: 'AMD Ryzen 7 7840U',
      memory: '32 GB',
      operatingSystem: 'NixOS 25.05',
      operatingSystemCodename: 'Warbler',
    },
    onClose: fn(),
    onMoreInfo: fn(),
  },
};

export const DesktopFallback: Story = {
  args: {
    isOpen: true,
    info: {
      deviceName: 'NixOS Desktop',
      manufacturer: 'Custom build',
      processor: 'AMD Ryzen 9 7950X',
      graphics: 'AMD Radeon RX 7900 XTX',
      memory: '64 GB',
      operatingSystem: 'NixOS 25.05',
    },
    onClose: fn(),
    onMoreInfo: fn(),
  },
};
