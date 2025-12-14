import type { Meta, StoryObj } from "@storybook/react";
import { Notification } from "./Notification";

const meta: Meta<typeof Notification> = {
  title: "Components/Notification",
  component: Notification,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="flex items-center justify-center min-h-screen bg-background-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Notification>;

// Basic notification - just title and body (most common)
export const Basic: Story = {
  args: {
    urgency: "normal",
    summary: "Screenshot saved",
    body: "Selection saved to /home/fbb/Pictures/screenshots/screenshot-area-2025-12-13_19-49-01.png",
    onClose: () => console.log("Notification closed"),
  },
};

// Notification with icon
export const WithIcon: Story = {
  args: {
    urgency: "normal",
    summary: "System Update",
    body: "A new system update is available",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <title>Info</title>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
      </svg>
    ),
    onClose: () => console.log("Notification closed"),
  },
};

// Notification with app name and time
export const WithHeader: Story = {
  args: {
    urgency: "normal",
    appName: "TESTAPP",
    time: "2m ago",
    summary: "Notification Title",
    body: "This is the notification body text",
    onClose: () => console.log("Notification closed"),
  },
};

// Minimal notification - icon + summary only (most compact)
export const Minimal: Story = {
  args: {
    urgency: "normal",
    summary: "Config Reloaded",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-blue-400" aria-hidden="true">
        <title>Reload</title>
        <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
      </svg>
    ),
  },
};

// Keyboard layout switch (simple, like in original screenshot)
export const KeyboardLayout: Story = {
  args: {
    urgency: "normal",
    summary: "Keyboard Layout",
    body: "Switched to: English (US)",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <title>Keyboard</title>
        <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
      </svg>
    ),
  },
};

// Low urgency
export const Low: Story = {
  args: {
    urgency: "low",
    appName: "Spotify",
    time: "5m ago",
    summary: "Now Playing",
    body: "Midnight City by M83",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <title>Music</title>
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    ),
  },
};

// Critical urgency
export const Critical: Story = {
  args: {
    urgency: "critical",
    appName: "Security",
    time: "Just now",
    summary: "Security Alert",
    body: "Failed login attempt detected from unknown location. Please verify your account security.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <title>Security</title>
        <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 14h2v2h-2v-2zm0-8h2v6h-2V8z" />
      </svg>
    ),
    onClose: () => console.log("Critical notification closed"),
  },
};

// With action buttons
export const WithActions: Story = {
  args: {
    urgency: "normal",
    appName: "Calendar",
    time: "10m ago",
    summary: "Meeting Reminder",
    body: "Your meeting with the design team starts in 15 minutes.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <title>Calendar</title>
        <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10z" />
      </svg>
    ),
    actions: [
      {
        id: "snooze",
        label: "Snooze",
        onClick: () => console.log("Snoozed"),
      },
      {
        id: "join",
        label: "Join Now",
        onClick: () => console.log("Joining meeting"),
      },
    ],
    onClose: () => console.log("Notification closed"),
  },
};

// With image
export const WithImage: Story = {
  args: {
    urgency: "normal",
    appName: "Photos",
    time: "1h ago",
    summary: "New Photo Album",
    body: "Check out the latest photos from your trip to the mountains.",
    image: "/wallpaper.png",
    actions: [
      {
        id: "view",
        label: "View Album",
        onClick: () => console.log("Viewing album"),
      },
    ],
    onClose: () => console.log("Notification closed"),
  },
};
