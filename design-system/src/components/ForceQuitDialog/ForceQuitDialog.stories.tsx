import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Desktop } from '../Desktop';
import { ForceQuitDialog } from './ForceQuitDialog';

const meta: Meta<typeof ForceQuitDialog> = {
  title: 'Components/ForceQuitDialog',
  component: ForceQuitDialog,
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
type Story = StoryObj<typeof ForceQuitDialog>;

export const RunningApplications: Story = {
  args: {
    isOpen: true,
    applications: [
      { id: 'browser', name: 'Firefox', icon: '\uE774', cpu: '12.1%', memory: '1.2 GB' },
      {
        id: 'editor',
        name: 'Visual Studio Code',
        icon: '\uE943',
        cpu: '4.6%',
        memory: '842 MB',
      },
      { id: 'terminal', name: 'Terminal', icon: '\uE756', cpu: '0.4%', memory: '178 MB' },
    ],
    onClose: fn(),
    onForceQuit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const forceQuitButton = canvas.getByRole('button', { name: 'Force Quit' });
    const editor = canvas.getByRole('option', { name: /Visual Studio Code/ });

    await expect(forceQuitButton).toBeDisabled();
    await userEvent.click(editor);
    await expect(editor).toHaveAttribute('aria-selected', 'true');
    await expect(forceQuitButton).toBeEnabled();
    await userEvent.click(forceQuitButton);
    await expect(args.onForceQuit).toHaveBeenCalledWith('editor');
  },
};

export const Empty: Story = {
  args: {
    isOpen: true,
    onClose: fn(),
  },
};

export const Unavailable: Story = {
  args: {
    isOpen: true,
    status: 'unavailable',
    unavailableMessage: 'The compositor did not provide running application details.',
    onClose: fn(),
  },
};
