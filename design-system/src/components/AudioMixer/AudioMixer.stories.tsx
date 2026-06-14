import type { Meta, StoryObj } from '@storybook/react-vite';
import type React from 'react';
import { useState } from 'react';
import { Desktop } from '../Desktop';
import {
  AudioMixer,
  type AudioMixerItem,
  type AudioMixerProps,
  type AudioMixerTab,
} from './AudioMixer';

const mixerItems: AudioMixerProps['items'] = {
  playback: [
    {
      id: 'firefox',
      name: 'Firefox',
      icon: '\uE774',
      volume: 82,
      peak: 68,
      target: 'Studio Display Speakers',
    },
    {
      id: 'spotify',
      name: 'Spotify',
      icon: '\uE768',
      volume: 46,
      peak: 38,
      target: 'USB-C Headphone Adapter',
    },
    {
      id: 'discord-output',
      name: 'Discord',
      icon: '\uE77B',
      volume: 110,
      muted: true,
      target: 'Studio Display Speakers',
    },
  ],
  output: [
    {
      id: 'speakers',
      name: 'Studio Display Speakers',
      icon: '\uE995',
      volume: 64,
      peak: 52,
      isDefault: true,
      route: 'Speakers',
    },
    {
      id: 'headphones',
      name: 'USB-C Headphone Adapter',
      icon: '\uE7F6',
      volume: 88,
      peak: 31,
      route: 'Headphones',
    },
  ],
  input: [
    {
      id: 'usb-mic',
      name: 'Wave:3 USB Microphone',
      icon: '\uE720',
      volume: 76,
      peak: 42,
      isDefault: true,
      route: 'Headset microphone',
    },
    {
      id: 'mic-array',
      name: 'Built-in Microphone',
      icon: '\uE720',
      volume: 52,
      peak: 16,
      route: 'Internal microphone',
    },
  ],
};

const baseArgs: AudioMixerProps = {
  maxVolume: 150,
  items: mixerItems,
};

function updateItemVolume(
  items: Partial<Record<AudioMixerTab, AudioMixerItem[]>>,
  itemId: string,
  volume: number
): Partial<Record<AudioMixerTab, AudioMixerItem[]>> {
  return Object.fromEntries(
    Object.entries(items).map(([tab, tabItems]) => [
      tab,
      tabItems?.map((item) => (item.id === itemId ? { ...item, volume } : item)),
    ])
  ) as Partial<Record<AudioMixerTab, AudioMixerItem[]>>;
}

const InteractiveMixer: React.FC<AudioMixerProps> = (args) => {
  const [items, setItems] = useState(args.items ?? {});

  return (
    <AudioMixer
      {...args}
      items={items}
      onVolumeChange={(itemId, volume) => {
        setItems((current) => updateItemVolume(current, itemId, volume));
      }}
    />
  );
};

const meta: Meta<typeof AudioMixer> = {
  title: 'Components/AudioMixer',
  component: AudioMixer,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    activeTab: {
      control: 'select',
      options: ['playback', 'output', 'input'],
    },
    maxVolume: {
      control: { type: 'range', min: 100, max: 150, step: 10 },
    },
    disableAnimations: {
      control: 'boolean',
    },
  },
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop minHeight="100vh" alignItems="center">
        <div className="flex items-center justify-center p-6">
          <Story />
        </div>
      </Desktop>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AudioMixer>;

export const Playback: Story = {
  args: {
    ...baseArgs,
    activeTab: 'playback',
  },
};

export const Output: Story = {
  args: {
    ...baseArgs,
    activeTab: 'output',
  },
};

export const DraggableVolume: Story = {
  render: (args) => <InteractiveMixer {...args} />,
  args: {
    ...baseArgs,
    activeTab: 'output',
  },
};

export const EmptyState: Story = {
  args: {
    activeTab: 'playback',
    items: {},
  },
};
