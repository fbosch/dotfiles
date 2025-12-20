import type { Meta, StoryObj } from '@storybook/react';
import { NotificationCenter } from './NotificationCenter';
import { Notification } from '../Notification';

const meta: Meta<typeof NotificationCenter> = {
  title: 'Components/NotificationCenter',
  component: NotificationCenter,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div
        className="flex items-center justify-center min-h-screen p-8"
        style={{
          backgroundImage: 'url(/wallpaper.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NotificationCenter>;

// Empty state - matches the image provided
export const Empty: Story = {
  args: {
    notifications: [],
    doNotDisturb: false,
    volume: 50,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};

// Floating notifications with notification center (like screenshot)
export const WithFloatingNotifications: Story = {
  args: {
    notifications: [],
    doNotDisturb: false,
    volume: 50,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
  decorators: [
    (Story) => (
      <div
        className="flex items-end justify-end min-h-screen p-8"
        style={{
          backgroundImage: 'url(/wallpaper.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="relative">
          {/* Floating notifications - positioned above the notification center */}
          <div className="absolute bottom-full right-0 mb-2 space-y-2">
            <Notification
              urgency="critical"
              summary="Screenshot failed"
              body="Could not capture active monitor."
              time="Now"
              onClose={() => console.log('Notification 1 closed')}
            />
            <Notification
              urgency="normal"
              summary="Screenshot Captured"
              body="Selection screenshot saved (108k)"
              time="Now"
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <title>Screenshot</title>
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                </svg>
              }
              actions={[
                {
                  id: 'view',
                  label: 'View Screenshot',
                  onClick: () => console.log('View screenshot'),
                },
                {
                  id: 'open',
                  label: 'Open Folder',
                  onClick: () => console.log('Open folder'),
                },
              ]}
              onClose={() => console.log('Notification 2 closed')}
            />
          </div>

          {/* Notification Center */}
          <Story />
        </div>
      </div>
    ),
  ],
};

// With a single notification
export const SingleNotification: Story = {
  args: {
    notifications: [
      {
        urgency: 'normal',
        summary: 'Screenshot saved',
        body: 'Selection saved to /home/fbb/Pictures/screenshots/screenshot-area-2025-12-13_19-49-01.png',
        onClose: () => console.log('Notification closed'),
      },
    ],
    doNotDisturb: false,
    volume: 65,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};

// With multiple notifications
export const MultipleNotifications: Story = {
  args: {
    notifications: [
      {
        urgency: 'normal',
        appName: 'TESTAPP',
        time: '2m ago',
        summary: 'System Update',
        body: 'A new system update is available',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <title>Update</title>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
        ),
        onClose: () => console.log('Notification 1 closed'),
      },
      {
        urgency: 'normal',
        appName: 'Layout Switcher',
        time: '5m ago',
        summary: 'Keyboard Layout',
        body: 'Switched to: English (US)',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <title>Keyboard</title>
            <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
          </svg>
        ),
        onClose: () => console.log('Notification 2 closed'),
      },
      {
        urgency: 'low',
        appName: 'Spotify',
        time: '15m ago',
        summary: 'Now Playing',
        body: 'Midnight City by M83',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <title>Music</title>
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        ),
        onClose: () => console.log('Notification 3 closed'),
      },
    ],
    doNotDisturb: false,
    volume: 75,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};

// Critical notification
export const WithCriticalNotification: Story = {
  args: {
    notifications: [
      {
        urgency: 'critical',
        appName: 'Security',
        time: 'Just now',
        summary: 'Security Alert',
        body: 'Failed login attempt detected from unknown location. Please verify your account security.',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <title>Security</title>
            <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 14h2v2h-2v-2zm0-8h2v6h-2V8z" />
          </svg>
        ),
        onClose: () => console.log('Critical notification closed'),
      },
      {
        urgency: 'normal',
        summary: 'Screenshot saved',
        body: 'Selection saved to ~/Pictures/screenshots/screenshot.png',
        onClose: () => console.log('Notification closed'),
      },
    ],
    doNotDisturb: false,
    volume: 80,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};

// Low volume
export const LowVolume: Story = {
  args: {
    notifications: [],
    doNotDisturb: false,
    volume: 15,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};

// High volume
export const HighVolume: Story = {
  args: {
    notifications: [],
    doNotDisturb: false,
    volume: 95,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};

// Full state - multiple notifications with DND and custom volume
export const FullState: Story = {
  args: {
    notifications: [
      {
        urgency: 'normal',
        appName: 'Calendar',
        time: '10m ago',
        summary: 'Meeting Reminder',
        body: 'Your meeting with the design team starts in 15 minutes.',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <title>Calendar</title>
            <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10z" />
          </svg>
        ),
        actions: [
          {
            id: 'snooze',
            label: 'Snooze',
            onClick: () => console.log('Snoozed'),
          },
          {
            id: 'join',
            label: 'Join Now',
            onClick: () => console.log('Joining meeting'),
          },
        ],
        onClose: () => console.log('Notification closed'),
      },
      {
        urgency: 'normal',
        summary: 'Config Reloaded',
        icon: (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-blue-400"
            aria-hidden="true"
          >
            <title>Reload</title>
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        ),
      },
    ],
    doNotDisturb: true,
    volume: 40,
    onDoNotDisturbChange: (enabled) => console.log('DND:', enabled),
    onVolumeChange: (volume) => console.log('Volume:', volume),
    onClearAll: () => console.log('Clear all clicked'),
  },
};
