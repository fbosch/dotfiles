import type { Meta, StoryObj } from '@storybook/react-vite';
import { Waybar } from './Waybar';

const meta: Meta<typeof Waybar> = {
  title: 'Components/Waybar',
  component: Waybar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    position: {
      control: 'radio',
      options: ['top', 'bottom'],
      description: 'Position of the waybar',
    },
    height: {
      control: { type: 'range', min: 30, max: 80, step: 5 },
      description: 'Height of the waybar in pixels',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Waybar>;

export const Default: Story = {
  args: {
    position: 'bottom',
    height: 45,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div
        style={{
          minHeight: '80vh',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backgroundColor: '#202020',
          padding: 0,
          margin: 0,
        }}
      >
        <div style={{ width: '100%' }}>
          <Story />
        </div>
      </div>
    ),
  ],
};
