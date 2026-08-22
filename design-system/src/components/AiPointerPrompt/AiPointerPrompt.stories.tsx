import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Desktop } from '../Desktop';
import { AiPointerPrompt, type AiPointerPromptProps } from './AiPointerPrompt';

const defaultArgs: AiPointerPromptProps = {
  value: '',
  state: { status: 'composing' },
  onChange: fn(),
  onSubmit: fn(),
  onCancel: fn(),
};

const meta: Meta<typeof AiPointerPrompt> = {
  title: 'Components/AiPointerPrompt',
  component: AiPointerPrompt,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story: React.ComponentType) => (
      <Desktop minHeight="100vh" alignItems="center">
        <div className="relative flex min-h-screen items-center justify-center p-8">
          <svg
            className="absolute left-[calc(50%-230px)] top-[calc(50%-68px)] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]"
            width="28"
            height="35"
            viewBox="0 0 28 35"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 2.5v25.2l6.3-6.1 4.2 10.1 4.3-1.8-4.2-10.1h9.1L3 2.5Z"
              fill="currentColor"
              stroke="#191919"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          <Story />
        </div>
      </Desktop>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AiPointerPrompt>;

function InteractivePrompt(args: AiPointerPromptProps) {
  const [value, setValue] = useState(args.value);
  return (
    <AiPointerPrompt
      {...args}
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue);
        args.onChange(nextValue);
      }}
    />
  );
}

export const Compose: Story = {
  args: defaultArgs,
  render: (args) => <InteractivePrompt {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Ask about this' });
    const send = canvas.getByRole('button', { name: 'Send question' });
    await expect(send).toBeDisabled();
    await userEvent.type(input, 'What does this mean?');
    await expect(send).toBeEnabled();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).toHaveBeenCalledWith('What does this mean?');
    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

export const Requesting: Story = {
  args: {
    ...defaultArgs,
    value: 'What does this mean?',
    state: { status: 'requesting' },
  },
  play: async ({ args, canvasElement }) => {
    const cancel = within(canvasElement).getByRole('button', { name: 'Cancel request' });
    await userEvent.hover(cancel);
    await userEvent.click(cancel);
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

export const Answered: Story = {
  args: {
    ...defaultArgs,
    value: 'What does this mean?',
    state: {
      status: 'answered',
      answer:
        'This setting keeps the selected surface out of screen-sharing and capture tools. It is useful for private shell UI that should remain visible only on your desktop.',
    },
  },
};

export const Failed: Story = {
  args: {
    ...defaultArgs,
    value: 'What does this mean?',
    state: {
      status: 'error',
      message: 'The configured model provider is unavailable. Nothing was sent.',
    },
  },
};
