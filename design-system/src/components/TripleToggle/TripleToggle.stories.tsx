import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Desktop } from '../Desktop';
import { TripleToggle } from './TripleToggle';

const options = [
  {
    value: 'auto',
    label: 'Auto',
    icon: <span className="font-fluent">{'\uF8B0'}</span>,
  },
  {
    value: 'gaming',
    label: 'Gaming',
    icon: <span className="font-nerd">{'\u{F02B4}'}</span>,
  },
  {
    value: 'saver',
    label: 'Saver',
    icon: <span className="font-fluent">{'\uEA95'}</span>,
  },
] as const;

const meta: Meta<typeof TripleToggle> = {
  title: 'Components/TripleToggle',
  component: TripleToggle,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop minHeight="100vh" alignItems="center">
        <div className="flex justify-center">
          <Story />
        </div>
      </Desktop>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TripleToggle>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('auto');

    return (
      <TripleToggle
        options={options}
        value={value}
        ariaLabel="Performance profile"
        onValueChange={setValue}
      />
    );
  },
};

export const WithBadge: Story = {
  args: {
    options: [
      {
        ...options[0],
        badge: (
          <span className="absolute -bottom-1 -right-1.5 grid size-3.5 place-items-center rounded-full bg-state-success font-fluent text-[8px] text-state-success-text ring-2 ring-accent-primary">
            {'\uE7FC'}
          </span>
        ),
        ariaLabel: 'Automatic profile rules; Game Mode is active',
        title: 'Game Mode is active automatically',
      },
      options[1],
      options[2],
    ],
    value: 'auto',
    ariaLabel: 'Performance profile',
  },
};

export const SaverActive: Story = {
  args: {
    options,
    value: 'saver',
    ariaLabel: 'Performance profile',
  },
};
