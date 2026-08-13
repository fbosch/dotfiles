import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Desktop } from '../Desktop';
import { SystemUpdateDialog } from './SystemUpdateDialog';

const meta: Meta<typeof SystemUpdateDialog> = {
  title: 'Components/SystemUpdateDialog',
  component: SystemUpdateDialog,
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
type Story = StoryObj<typeof SystemUpdateDialog>;

export const CheckForUpdates: Story = {
  args: {
    isOpen: true,
    description: 'Check your flake inputs for newer upstream revisions.',
    progress: null,
    phase: 'Your system is ready to check',
    message: 'The last successful update check was today at 14:32.',
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Check for updates',
    onPrimaryAction: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Check for updates' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const CheckingForUpdates: Story = {
  args: {
    isOpen: true,
    description: 'Comparing your flake inputs with their configured upstream sources.',
    progress: 'indeterminate',
    phase: 'Checking for updates...',
    message: 'Fetching the latest revision metadata.',
    elapsedTime: '8s',
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('Checking for updates...')).toBeVisible();
    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(canvas.getByText('Elapsed 8s')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};

export const CheckFailed: Story = {
  args: {
    isOpen: true,
    description: 'The update check could not be completed.',
    progress: null,
    phase: 'Could not check for updates',
    errorMessage: 'The configured flake source could not be reached. Your system was not changed.',
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('alert')).toHaveTextContent('Your system was not changed.');
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const RebuildingSystem: Story = {
  args: {
    isOpen: true,
    progress: 68,
    phase: 'Rebuilding system...',
    elapsedTime: '1m 24s',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete' },
      { id: 'rebuild', label: 'Rebuild system', status: 'in-progress' },
    ],
    currentGeneration: 'generation 182',
    currentGenerationDate: '2026-08-10',
    technicalDetails: [
      'updating lock file "/etc/nixos/flake.lock"',
      'building the system configuration...',
      'these 42 derivations will be built:',
      'activating the configuration...',
    ],
    technicalDetailsOpen: true,
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('progressbar', { name: 'Rebuilding system...' })).toHaveAttribute(
      'aria-valuenow',
      '68'
    );
    await expect(canvas.getByText('activating the configuration...')).toBeVisible();
    await expect(canvas.getByText('Elapsed 1m 24s')).toBeVisible();
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Automatically check for updates' })
    );
    await expect(args.onAutomaticallyCheckForUpdatesChange).toHaveBeenCalledWith(false);
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};

export const LockfileUpdateFailed: Story = {
  args: {
    isOpen: true,
    description: 'The selected flake inputs could not be updated.',
    progress: 18,
    phase: 'Lockfile update failed',
    elapsedTime: '14s',
    errorMessage:
      'The rebuild did not start and the active system generation was not changed. Review the technical details before retrying.',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'failed' },
      { id: 'rebuild', label: 'Rebuild system', status: 'pending' },
    ],
    currentGeneration: 'generation 182',
    currentGenerationDate: '2026-08-10',
    technicalDetails: [
      'error: failed to update input nixpkgs',
      'error: unable to download the requested revision',
      'the system rebuild was not started',
    ],
    technicalDetailsOpen: true,
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('Failed')).toBeVisible();
    await expect(canvas.getByText('Pending')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const ReadyToActivate: Story = {
  args: {
    isOpen: true,
    description: 'The new system configuration is built and ready.',
    progress: 100,
    phase: 'Update ready to activate',
    message: 'The new system configuration was built successfully.',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete' },
      { id: 'rebuild', label: 'Rebuild system', status: 'complete' },
    ],
    currentGeneration: 'generation 182',
    currentGenerationDate: '2026-08-10',
    technicalDetails: [
      'updated lock file "/etc/nixos/flake.lock"',
      'built system closure /nix/store/9m2...-nixos-system-workstation',
      'activation is waiting for confirmation',
    ],
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Activate now',
    onPrimaryAction: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await userEvent.click(canvas.getByRole('button', { name: 'Activate now' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const RebuildFailed: Story = {
  args: {
    isOpen: true,
    description: 'The new system configuration could not be activated.',
    progress: 74,
    phase: 'System update failed',
    elapsedTime: '2m 11s',
    errorMessage:
      'The previous flake.lock was restored. The active system generation was not changed.',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete' },
      { id: 'rebuild', label: 'Rebuild system', status: 'failed' },
    ],
    currentGeneration: 'generation 182',
    currentGenerationDate: '2026-08-10',
    technicalDetails: [
      'error: builder for system closure failed',
      'restored /etc/nixos/flake.lock to its pre-update state',
      'the active system generation remains generation 182',
    ],
    technicalDetailsOpen: true,
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'The previous flake.lock was restored.'
    );
    await expect(canvas.getByText('Failed')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};
