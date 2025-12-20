import type { Meta, StoryObj } from '@storybook/react';
import { Desktop } from '../Desktop';
import { type AppItem, AppSwitcher } from './AppSwitcher';

const meta: Meta<typeof AppSwitcher> = {
  title: 'Components/AppSwitcher',
  component: AppSwitcher,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <Desktop alignItems="center">
        <Story />
      </Desktop>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AppSwitcher>;

const sampleApps: AppItem[] = [
  {
    id: 'finder',
    name: 'Finder',
    icon: '/icons/firefox.svg',
  },
  {
    id: 'ivory',
    name: 'Ivory',
    icon: '/icons/firefox.svg',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: '/icons/firefox.svg',
  },
  {
    id: 'crystal',
    name: 'Crystal',
    icon: '/icons/firefox.svg',
  },
  {
    id: 'tick-tick',
    name: 'Tick Tick',
    icon: '/icons/firefox.svg',
    badge: 5,
  },
  {
    id: 'playback',
    name: 'Playback',
    icon: '/icons/firefox.svg',
  },
];

export const Default: Story = {
  args: {
    isOpen: true,
    apps: sampleApps,
    selectedIndex: 1,
  },
};

export const WithBadge: Story = {
  args: {
    isOpen: true,
    apps: sampleApps,
    selectedIndex: 4,
  },
};

export const FirstApp: Story = {
  args: {
    isOpen: true,
    apps: sampleApps,
    selectedIndex: 0,
  },
};

export const WithPreviews: Story = {
  args: {
    isOpen: true,
    showPreviews: true,
    apps: [
      {
        id: 'nixos-vm',
        name: 'NixOS 3rd (Before Grub Theme Activation) [Running] - Oracle VirtualBox',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=800&h=600&fit=crop',
        aspectRatio: 16 / 9,
      },
      {
        id: 'hbo-max',
        name: 'Silly Samuel • HBO Max — Zen Browser',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1574267432644-f71ca85d7fbc?w=800&h=600&fit=crop',
        aspectRatio: 16 / 9,
      },
      {
        id: 'vbox-manager',
        name: 'Oracle VirtualBox Manager',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1587440871875-191322ee64b0?w=800&h=600&fit=crop',
        aspectRatio: 16 / 9,
      },
    ],
    selectedIndex: 0,
  },
};

export const WithPreviewsVertical: Story = {
  args: {
    isOpen: true,
    showPreviews: true,
    apps: [
      {
        id: 'browser',
        name: 'Firefox — YouTube',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&h=600&fit=crop',
        aspectRatio: 16 / 9,
      },
      {
        id: 'terminal',
        name: 'Terminal — zsh',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=600&h=900&fit=crop',
        aspectRatio: 9 / 16,
      },
      {
        id: 'spotify',
        name: 'Spotify',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?w=800&h=600&fit=crop',
        aspectRatio: 16 / 9,
      },
      {
        id: 'mobile-app',
        name: 'iPhone Simulator',
        icon: '/icons/firefox.svg',
        preview: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=600&h=900&fit=crop',
        aspectRatio: 9 / 16,
      },
    ],
    selectedIndex: 1,
  },
};

