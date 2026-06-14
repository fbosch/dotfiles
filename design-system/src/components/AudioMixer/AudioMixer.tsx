import { cva } from 'class-variance-authority';
import type React from 'react';
import { useRef } from 'react';
import { cn } from '../../utils/cn';

export type AudioMixerTab = 'playback' | 'output' | 'input';

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
  onVolumeChange?: (itemId: string, volume: number) => void;
  className?: string;
}

const tabMeta: Record<AudioMixerTab, { label: string; icon: string }> = {
  playback: {
    label: 'Playback',
    icon: '\uE768',
  },
  output: {
    label: 'Output',
    icon: '\uE995',
  },
  input: {
    label: 'Input',
    icon: '\uE720',
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

const VolumeMeter: React.FC<{
  item: AudioMixerItem;
  maxVolume: number;
  onVolumeChange?: (itemId: string, volume: number) => void;
}> = ({ item, maxVolume, onVolumeChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);

  if (item.volume === undefined) return null;

  const volume = clamp(item.volume, maxVolume);
  const visibleVolume = item.muted ? 0 : volume;
  const peakVolume = item.muted ? 0 : clamp(item.peak ?? 0, maxVolume);
  const thumbPosition = item.muted ? 0 : (volume / maxVolume) * 100;

  const updateVolumeFromPointer = (clientX: number) => {
    if (!trackRef.current || !onVolumeChange) return;

    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const nextVolume = ((clientX - rect.left) / rect.width) * maxVolume;
    onVolumeChange(item.id, clamp(nextVolume, maxVolume));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onVolumeChange) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateVolumeFromPointer(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateVolumeFromPointer(event.clientX);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onVolumeChange) return;

    const step = event.shiftKey ? 10 : 5;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onVolumeChange(item.id, clamp(volume - step, maxVolume));
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onVolumeChange(item.id, clamp(volume + step, maxVolume));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onVolumeChange(item.id, 0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      onVolumeChange(item.id, maxVolume);
    }
  };

  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[11px] text-foreground-tertiary">
        <span>{item.muted ? 'Muted' : `${volume}%`}</span>
        {item.peak !== undefined && <span>Peak {clamp(item.peak, maxVolume)}%</span>}
      </div>
      <div
        ref={trackRef}
        className={cn(
          'group relative flex gap-0.5 py-2 outline-none',
          onVolumeChange &&
            'cursor-pointer touch-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary'
        )}
        role="slider"
        tabIndex={onVolumeChange ? 0 : -1}
        aria-label={`${item.name} volume`}
        aria-valuemin={0}
        aria-valuemax={maxVolume}
        aria-valuenow={volume}
        aria-disabled={!onVolumeChange}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        {volumeSegments.map((segment) => {
          const segmentStart = ((segment - 1) / volumeSegments.length) * maxVolume;
          const segmentEnd = (segment / volumeSegments.length) * maxVolume;
          const segmentRange = segmentEnd - segmentStart;
          const fillWidth = clamp(((visibleVolume - segmentStart) / segmentRange) * 100, 100);
          const peakWidth = clamp(((peakVolume - segmentStart) / segmentRange) * 100, 100);

          return (
            <div
              key={`${item.id}-segment-${segment}`}
              className="relative h-2 flex-1 overflow-hidden rounded-sm bg-white/[0.08]"
            >
              {peakWidth > fillWidth && (
                <div
                  className="absolute inset-y-0 left-0 bg-accent-primary/35"
                  style={{ width: `${peakWidth}%` }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 bg-accent-primary"
                style={{ width: `${fillWidth}%` }}
              />
            </div>
          );
        })}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]',
            onVolumeChange && 'group-hover:h-5 group-focus-visible:h-5',
            item.muted && 'opacity-50'
          )}
          style={{ left: `${thumbPosition}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
};

const AudioRow: React.FC<{
  item: AudioMixerItem;
  maxVolume: number;
  onVolumeChange?: (itemId: string, volume: number) => void;
}> = ({ item, maxVolume, onVolumeChange }) => (
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

        <VolumeMeter item={item} maxVolume={maxVolume} onVolumeChange={onVolumeChange} />
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
  onVolumeChange,
  className,
}) => {
  const currentItems = items[activeTab] ?? [];
  const normalizedMaxVolume = Math.max(1, maxVolume);

  return (
    <section
      className={cn(panelVariants({ animated: !disableAnimations }), className)}
      aria-label="Audio mixer"
    >
      <header className="border-b border-white/[0.1] p-3">
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
              <AudioRow
                key={item.id}
                item={item}
                maxVolume={normalizedMaxVolume}
                onVolumeChange={onVolumeChange}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
