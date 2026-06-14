import { cva } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';

export type AudioMixerTab = 'playback' | 'recording' | 'output' | 'input' | 'configuration';

export interface AudioMixerItem {
  id: string;
  name: string;
  icon?: string;
  volume?: number;
  muted?: boolean;
  isDefault?: boolean;
  target?: string;
  route?: string;
  profile?: string;
  peak?: number;
}

export interface AudioMixerProps {
  activeTab?: AudioMixerTab;
  items?: Partial<Record<AudioMixerTab, AudioMixerItem[]>>;
  maxVolume?: number;
  disableAnimations?: boolean;
  onTabChange?: (tab: AudioMixerTab) => void;
  className?: string;
}

const tabMeta: Record<AudioMixerTab, { label: string; icon: string }> = {
  playback: {
    label: 'Playback',
    icon: '\uE768',
  },
  recording: {
    label: 'Recording',
    icon: '\uE720',
  },
  output: {
    label: 'Output',
    icon: '\uE995',
  },
  input: {
    label: 'Input',
    icon: '\uE720',
  },
  configuration: {
    label: 'Config',
    icon: '\uE713',
  },
};

const tabs = Object.keys(tabMeta) as AudioMixerTab[];
const volumeSegments = Array.from({ length: 12 }, (_, index) => index + 1);

const panelVariants = cva(
  'w-[500px] overflow-hidden rounded-xl border border-white/15 bg-background-secondary/90 text-foreground-primary shadow-[0_8px_32px_rgba(0,0,0,0.24),0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-md font-primary',
  {
    variants: {
      animated: {
        true: 'transition-colors duration-150',
        false: '',
      },
    },
    defaultVariants: {
      animated: true,
    },
  }
);

const tabVariants = cva(
  'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs outline-none',
  {
    variants: {
      active: {
        true: 'bg-accent-primary text-white shadow-sm',
        false:
          'text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:bg-white/10 focus-visible:text-foreground-primary',
      },
      animated: {
        true: 'transition-colors duration-150',
        false: '',
      },
    },
    defaultVariants: {
      active: false,
      animated: true,
    },
  }
);

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function itemIcon(item: AudioMixerItem): string {
  if (item.icon) return item.icon;
  if (item.muted || item.volume === 0) return '\uE74F';
  if ((item.volume ?? 0) <= 30) return '\uE993';
  return '\uE995';
}

const Badge: React.FC<{ children: React.ReactNode; tone?: 'default' | 'accent' | 'muted' }> = ({
  children,
  tone = 'accent',
}) => (
  <span
    className={cn(
      'rounded-full border px-2 py-0.5 text-[11px]',
      tone === 'accent' && 'border-accent-primary/40 bg-accent-primary/20 text-foreground-primary',
      tone === 'muted' && 'border-state-error/30 bg-state-error/10 text-state-error'
    )}
  >
    {children}
  </span>
);

const VolumeMeter: React.FC<{ item: AudioMixerItem; maxVolume: number }> = ({
  item,
  maxVolume,
}) => {
  if (item.volume === undefined) return null;

  const volume = clamp(item.volume, maxVolume);
  const filled = item.muted ? 0 : Math.round((volume / maxVolume) * volumeSegments.length);
  const peak = Math.round((clamp(item.peak ?? 0, maxVolume) / maxVolume) * volumeSegments.length);

  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[11px] text-foreground-tertiary">
        <span>{item.muted ? 'Muted' : `${volume}%`}</span>
        {item.peak !== undefined && <span>Peak {clamp(item.peak, maxVolume)}%</span>}
      </div>
      <div className="flex gap-0.5" aria-hidden="true">
        {volumeSegments.map((segment) => (
          <div
            key={`${item.id}-segment-${segment}`}
            className={cn(
              'h-2 flex-1 rounded-sm',
              segment <= filled && 'bg-accent-primary',
              segment > filled && segment <= peak && !item.muted && 'bg-accent-primary/35',
              (segment > filled || item.muted) && segment > peak && 'bg-white/[0.08]'
            )}
          />
        ))}
      </div>
    </div>
  );
};

const AudioRow: React.FC<{ item: AudioMixerItem; maxVolume: number }> = ({ item, maxVolume }) => (
  <article
    className={cn(
      'rounded-lg border border-white/[0.08] bg-background-primary/45 p-3 shadow-sm',
      item.muted && 'opacity-70'
    )}
  >
    <div className="flex gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-foreground-primary">
        <span className="font-fluent text-lg" aria-hidden="true">
          {itemIcon(item)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground-primary">{item.name}</h3>
          </div>
          {item.isDefault && <Badge tone="accent">Default</Badge>}
          {item.muted && <Badge tone="muted">Muted</Badge>}
        </div>

        <VolumeMeter item={item} maxVolume={maxVolume} />
      </div>
    </div>
  </article>
);

export const AudioMixer: React.FC<AudioMixerProps> = ({
  activeTab = 'playback',
  items = {},
  maxVolume = 150,
  disableAnimations = false,
  onTabChange,
  className,
}) => {
  const currentItems = items[activeTab] ?? [];
  const currentTab = tabMeta[activeTab];
  const normalizedMaxVolume = Math.max(1, maxVolume);

  return (
    <section
      className={cn(panelVariants({ animated: !disableAnimations }), className)}
      aria-label="Audio mixer"
    >
      <header className="border-b border-white/[0.1] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground-primary">Audio</h1>
          </div>
          <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-foreground-tertiary">
            {normalizedMaxVolume}% max
          </span>
        </div>

        <nav
          className="flex gap-1 rounded-lg bg-background-primary/50 p-1"
          aria-label="Audio mixer tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={tabVariants({ active: tab === activeTab, animated: !disableAnimations })}
              onClick={() => onTabChange?.(tab)}
              aria-pressed={tab === activeTab}
            >
              <span className="font-fluent" aria-hidden="true">
                {tabMeta[tab].icon}
              </span>
              <span className="truncate">{tabMeta[tab].label}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="max-h-[520px] overflow-y-auto p-3">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground-primary">{currentTab.label}</h2>
        </div>

        {currentItems.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-background-primary/30 p-8 text-center">
            <span className="font-fluent text-3xl text-foreground-tertiary/60" aria-hidden="true">
              {'\uE7F4'}
            </span>
            <p className="mt-3 text-sm font-medium text-foreground-secondary">No audio objects</p>
          </div>
        ) : (
          <div className="space-y-2">
            {currentItems.map((item) => (
              <AudioRow key={item.id} item={item} maxVolume={normalizedMaxVolume} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
