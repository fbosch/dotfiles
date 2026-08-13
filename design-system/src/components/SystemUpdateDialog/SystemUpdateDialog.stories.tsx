import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Desktop } from '../Desktop';
import { SystemUpdateDialog } from './SystemUpdateDialog';

const meta: Meta<typeof SystemUpdateDialog> = {
  title: 'Components/SystemUpdateDialog',
  component: SystemUpdateDialog,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    currentGeneration: '182',
    currentGenerationDate: '2026-08-10',
    onCopyTechnicalDetails: fn(),
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
    progress: null,
    phase: 'Ready to check',
    message: 'Last checked today at 14:32.',
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Check for updates',
    onPrimaryAction: fn(),
    onCancel: fn(),
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
    progress: 'indeterminate',
    phase: 'Checking for updates...',
    message: 'Fetching revision metadata.',
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

export const CachedUpdatesAvailable: Story = {
  args: {
    isOpen: true,
    progress: null,
    phase: '3 updates available',
    updatesCheckedAt: '8 minutes ago',
    availableUpdates: [
      {
        name: 'nixpkgs',
        currentRevision: 'a1b2c3d',
        newRevision: 'e4f5a6b',
      },
      {
        name: 'home-manager',
        currentRevision: '18d9f21',
        newRevision: '72ac880',
      },
      {
        name: 'ags',
        currentRevision: '31f490c',
        newRevision: '8b54e12',
      },
    ],
    onUpdateSelectionChange: fn(),
    onSelectAllUpdatesChange: fn(),
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    secondaryActionLabel: 'Check again',
    onSecondaryAction: fn(),
    primaryActionLabel: 'Update selected inputs',
    onPrimaryAction: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  render: (args) => {
    const [updates, setUpdates] = useState(args.availableUpdates ?? []);

    return (
      <SystemUpdateDialog
        {...args}
        availableUpdates={updates}
        onUpdateSelectionChange={(inputName, selected) => {
          setUpdates((current) =>
            current.map((update) => (update.name === inputName ? { ...update, selected } : update))
          );
          args.onUpdateSelectionChange?.(inputName, selected);
        }}
        onSelectAllUpdatesChange={(selected) => {
          setUpdates((current) => current.map((update) => ({ ...update, selected })));
          args.onSelectAllUpdatesChange?.(selected);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const nixpkgs = canvas.getByRole('checkbox', { name: 'Update nixpkgs' });
    const selectAll = canvas.getByRole('checkbox', { name: /Select all inputs/ });

    await expect(canvas.getByText('nixpkgs')).toBeVisible();
    await expect(canvas.getByText('a1b2c3d → e4f5a6b')).toBeVisible();
    await expect(nixpkgs).toBeChecked();
    await expect(selectAll).toBeChecked();
    await userEvent.click(nixpkgs);
    await expect(nixpkgs).not.toBeChecked();
    await expect(args.onUpdateSelectionChange).toHaveBeenCalledWith('nixpkgs', false);
    await userEvent.click(selectAll);
    await expect(nixpkgs).toBeChecked();
    await expect(args.onSelectAllUpdatesChange).toHaveBeenCalledWith(true);
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }));
    await expect(args.onSecondaryAction).toHaveBeenCalledOnce();
  },
};

export const NoUpdatesAvailable: Story = {
  args: {
    isOpen: true,
    progress: null,
    summaryVariant: 'success',
    phase: 'No updates available',
    message: 'Checked just now.',
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    secondaryActionLabel: 'Check again',
    onSecondaryAction: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('No updates available')).toBeVisible();
    await expect(canvas.getByText('Checked just now.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }));
    await expect(args.onSecondaryAction).toHaveBeenCalledOnce();
  },
};

export const CheckFailed: Story = {
  args: {
    isOpen: true,
    progress: null,
    phase: 'Update check failed',
    errorMessage: 'Could not reach the configured flake source. No changes were made.',
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('alert')).toHaveTextContent('No changes were made.');
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const RebuildingSystem: Story = {
  args: {
    isOpen: true,
    progress: 68,
    progressIsEstimated: true,
    phase: 'Rebuilding system...',
    elapsedTime: '1m 24s',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete', duration: '7s' },
      { id: 'rebuild', label: 'Rebuild system', status: 'in-progress' },
      { id: 'activate', label: 'Activate configuration', status: 'pending' },
    ],
    technicalDetails: [
      'updating lock file "/etc/nixos/flake.lock"',
      'building the system configuration...',
      'these 42 derivations will be built:',
      'activating the configuration...',
    ],
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
    await expect(canvas.getByText('~68%')).toBeVisible();
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
    progress: null,
    phase: 'Lockfile update failed',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'failed', duration: '14s' },
      { id: 'rebuild', label: 'Rebuild system', status: 'pending' },
      { id: 'activate', label: 'Activate configuration', status: 'pending' },
    ],
    technicalDetails: [
      'error: failed to update input nixpkgs',
      'error: unable to download the requested revision',
      'the system rebuild was not started',
    ],
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument();
    await expect(
      canvas.getByRole('listitem', { name: 'Update lockfile: Failed, 14s' })
    ).toBeVisible();
    await expect(canvas.getByRole('listitem', { name: 'Rebuild system: Pending' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const ReadyToActivate: Story = {
  args: {
    isOpen: true,
    progress: 100,
    phase: 'Ready to activate',
    message: 'Build completed successfully.',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete', duration: '7s' },
      { id: 'rebuild', label: 'Rebuild system', status: 'complete', duration: '1m 46s' },
      { id: 'activate', label: 'Activate configuration', status: 'pending' },
    ],
    technicalDetails: [
      'updated lock file "/etc/nixos/flake.lock"',
      'built system closure /nix/store/9m2...-nixos-system-workstation',
      'activation is waiting for confirmation',
    ],
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Activate now',
    onPrimaryAction: fn(),
    onCancel: fn(),
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
    progress: 74,
    progressIsEstimated: true,
    phase: 'Rebuild failed',
    elapsedTime: '2m 11s',
    errorMessage: 'The previous flake.lock was restored.',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete', duration: '7s' },
      { id: 'rebuild', label: 'Rebuild system', status: 'failed', duration: '2m 04s' },
      { id: 'activate', label: 'Activate configuration', status: 'pending' },
    ],
    technicalDetails: [
      'error: builder for system closure failed',
      'restored /etc/nixos/flake.lock to its pre-update state',
      'the active generation may require verification',
    ],
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'The previous flake.lock was restored.'
    );
    await expect(
      canvas.getByRole('listitem', { name: 'Rebuild system: Failed, 2m 04s' })
    ).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};

export const ActivatingConfiguration: Story = {
  args: {
    isOpen: true,
    progress: 'indeterminate',
    phase: 'Activating configuration...',
    elapsedTime: '2m 03s',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete', duration: '7s' },
      { id: 'rebuild', label: 'Rebuild system', status: 'complete', duration: '1m 46s' },
      { id: 'activate', label: 'Activate configuration', status: 'in-progress' },
    ],
    technicalDetails: [
      'built system closure /nix/store/9m2...-nixos-system-workstation',
      'activating the configuration...',
      'reloading user units...',
    ],
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    onClose: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(canvas.getByText('Activate configuration')).toBeVisible();
  },
};

export const ActivationFailed: Story = {
  args: {
    isOpen: true,
    progress: null,
    phase: 'Activation failed',
    steps: [
      { id: 'lockfile', label: 'Update lockfile', status: 'complete', duration: '7s' },
      { id: 'rebuild', label: 'Rebuild system', status: 'complete', duration: '1m 46s' },
      { id: 'activate', label: 'Activate configuration', status: 'failed', duration: '19s' },
    ],
    errorMessage: 'The active system state may be partially updated.',
    technicalDetails: [
      'activating the configuration...',
      'error: failed to restart user service example.service',
      'verify the active generation and affected services before retrying',
    ],
    automaticallyCheckForUpdates: true,
    onAutomaticallyCheckForUpdatesChange: fn(),
    primaryActionLabel: 'Retry',
    onPrimaryAction: fn(),
    onCancel: fn(),
    onClose: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument();
    await expect(
      canvas.getByRole('listitem', { name: 'Activate configuration: Failed, 19s' })
    ).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'The active system state may be partially updated.'
    );
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await expect(args.onPrimaryAction).toHaveBeenCalledOnce();
  },
};
