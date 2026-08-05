import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { AboutThisPC } from '../AboutThisPC';
import { Desktop } from '../Desktop';
import { ForceQuitDialog } from '../ForceQuitDialog';
import { Waybar } from '../Waybar/Waybar';
import { StartMenu } from './StartMenu';

const recentItems = {
  applications: [
    { id: 'vscode', label: 'Visual Studio Code', icon: '\uE943', detail: '5 minutes ago' },
    { id: 'terminal', label: 'Terminal', icon: '\uE756', detail: 'Today' },
  ],
  documents: [
    { id: 'proposal', label: 'kiwi-inspired-start-menu.md', icon: '\uE8A5', detail: 'Documents' },
    { id: 'design', label: 'desktop-layout.fig', icon: '\uE8A5', detail: 'Design' },
  ],
};

const meta: Meta<typeof StartMenu> = {
  title: 'Components/StartMenu',
  component: StartMenu,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof StartMenu>;

export const SpawningFromWaybar: Story = {
  render: () => {
    const [isMenuOpen, setIsMenuOpen] = useState(true);

    return (
      <Desktop>
        <div className="relative w-full">
          <StartMenu
            isOpen={isMenuOpen}
            recentItems={recentItems}
            nixFlakeUpdatesCount={3}
            flatpakUpdatesCount={2}
            onClose={() => setIsMenuOpen(false)}
            onItemClick={fn()}
            onRecentItemClick={fn()}
            onClearRecentItems={fn()}
            style={{ position: 'absolute', bottom: '53px', left: '8px' }}
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              className="absolute left-1 top-0 z-10 h-full w-12"
              aria-label="Toggle Start Menu"
            />
            <Waybar position="bottom" height={45} />
          </div>
        </div>
      </Desktop>
    );
  },
};

export const RecentItems: Story = {
  args: {
    isOpen: true,
    recentItems,
    nixFlakeUpdatesCount: 3,
    flatpakUpdatesCount: 2,
    onClose: fn(),
    onRecentItemClick: fn(),
    onClearRecentItems: fn(),
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="min-h-screen bg-background-primary p-8">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('menuitem', { name: 'Recent Items' });

    await userEvent.hover(trigger);
    await expect(canvas.queryByRole('menu', { name: 'Recent Items' })).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('menu', { name: 'Recent Items' })).toBeVisible());

    await userEvent.unhover(trigger);
    await expect(canvas.getByRole('menu', { name: 'Recent Items' })).toBeVisible();
    await waitFor(() =>
      expect(canvas.queryByRole('menu', { name: 'Recent Items' })).not.toBeInTheDocument()
    );

    trigger.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('menu', { name: 'Recent Items' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.queryByRole('menu', { name: 'Recent Items' })).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await expect(canvas.getByRole('menu', { name: 'Recent Items' })).toBeVisible();
  },
};

export const RecentItemsAtRightEdge: Story = {
  args: {
    isOpen: true,
    recentItems,
    onClose: fn(),
    onRecentItemClick: fn(),
    onClearRecentItems: fn(),
    style: { position: 'fixed', bottom: '8px', right: '8px' },
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="min-h-screen bg-background-primary">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Recent Items' }));
    await expect(canvas.getByRole('menu', { name: 'Recent Items' })).toHaveAttribute(
      'data-side',
      'left'
    );
  },
};

export const EmptyRecentItems: Story = {
  args: {
    isOpen: true,
    recentItems: {},
    onClose: fn(),
    onClearRecentItems: fn(),
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="min-h-screen bg-background-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export const WithAutomaticGaming: Story = {
  args: {
    isOpen: true,
    profile: {
      mode: 'gaming',
      source: 'auto',
      manualMode: 'default',
    },
    onProfileChange: fn(),
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="min-h-screen bg-background-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export const WithPinnedGaming: Story = {
  args: {
    isOpen: true,
    profile: {
      mode: 'gaming',
      source: 'manual',
      manualMode: 'gaming',
    },
    onProfileChange: fn(),
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="min-h-screen bg-background-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export const SystemSurfaces: Story = {
  render: () => {
    const [surface, setSurface] = useState<'force-quit' | 'about-this-pc' | null>(null);

    return (
      <Desktop minHeight="100vh">
        <div className="p-8">
          <StartMenu
            isOpen={true}
            recentItems={recentItems}
            onItemClick={(itemId) => {
              if (itemId === 'force-quit' || itemId === 'about-this-pc') setSurface(itemId);
            }}
          />
        </div>
        <ForceQuitDialog
          isOpen={surface === 'force-quit'}
          applications={[
            { id: 'browser', name: 'Firefox', icon: '\uE774', cpu: '12.1%', memory: '1.2 GB' },
            {
              id: 'editor',
              name: 'Visual Studio Code',
              icon: '\uE943',
              cpu: '4.6%',
              memory: '842 MB',
            },
          ]}
          onClose={() => setSurface(null)}
          onForceQuit={fn()}
        />
        <AboutThisPC
          isOpen={surface === 'about-this-pc'}
          info={{
            deviceName: 'NixOS Workstation',
            manufacturer: 'Framework',
            processor: 'AMD Ryzen 7 7840U',
            memory: '32 GB',
            desktop: 'Hyprland',
            operatingSystem: 'NixOS 25.05',
          }}
          onClose={() => setSurface(null)}
          onMoreInfo={fn()}
        />
      </Desktop>
    );
  },
};
