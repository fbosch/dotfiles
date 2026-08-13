import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Desktop } from '../Desktop';
import { ProgressBar } from './ProgressBar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Components/ProgressBar',
  component: ProgressBar,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
    variant: {
      control: 'select',
      options: ['primary', 'error'],
    },
  },
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop minHeight="100vh" alignItems="center">
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-background-secondary/90 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.24)] backdrop-blur-md">
          <Story />
        </div>
      </Desktop>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Determinate: Story = {
  args: {
    value: 68,
    'aria-label': 'Rebuild progress',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '68');
  },
};

export const AnimatedPrimary: Story = {
  args: {
    indeterminate: true,
    'aria-label': 'Fetching flake inputs',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  },
};

export const AnimatedError: Story = {
  args: {
    indeterminate: true,
    variant: 'error',
    'aria-label': 'Retrying failed operation',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  },
};
