import { cva } from 'class-variance-authority';
import type React from 'react';
import { useRef } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../Button';

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
  onMuteToggle?: (itemId: string) => void;
  onDefaultChange?: (itemId: string) => void;
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
  'w-[500px] overflow-hidden rounded-xl border border-surface-keyline bg-background-secondary/90 font-primary text-foreground-primary shadow-[0_8px_32px_rgba(0,0,0,0.24),0_2px_8px_rgba(0,0,0,0.12)] outline outline-1 outline-surface-border backdrop-blur-md',
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

const tabVariants = cva('min-w-0 flex-1 gap-1 px-2 py-1.5', {
  variants: {
    animated: {
      true: 'transition-colors duration-150',
      false: '',
    },
  },
  defaultVariants: {
    animated: true,
  },
});

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function itemIcon(item: AudioMixerItem): string {
  if (item.icon) return item.icon;
  if (item.muted || item.volume === 0) return '\uE74F';
  if ((item.volume ?? 0) <= 30) return '\uE993';
  return '\uE995';
}

const VolumeMeter: React.FC<{
  item: AudioMixerItem;
  maxVolume: number;
  onVolumeChange?: (itemId: string, volume: number) => void;
}> = ({ item, maxVolume, onVolumeChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);

  if (item.volume === undefined) return null;

  const volume = clamp(item.volume, maxVolume);
  const visibleVolume = item.muted ? 0 : volume;
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
    <div className="mt-0.5">
      <div className="text-sm text-foreground-tertiary">
        <span>{item.muted ? 'Muted' : `${volume}%`}</span>
      </div>
      <div
        ref={trackRef}
        className={cn(
          'group relative flex gap-0.5 py-1.5 outline-none',
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

          return (
            <div
              key={`${item.id}-segment-${segment}`}
              className="relative h-2 flex-1 overflow-hidden rounded-sm bg-white/[0.08]"
            >
              <div
                className="absolute inset-y-0 left-0 bg-accent-primary"
                style={{ width: `${fillWidth}%` }}
              />
            </div>
          );
        })}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]',
            onVolumeChange && 'group-hover:h-4 group-focus-visible:h-4',
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
  onMuteToggle?: (itemId: string) => void;
  onDefaultChange?: (itemId: string) => void;
  showDefaultAction: boolean;
}> = ({ item, maxVolume, onVolumeChange, onMuteToggle, onDefaultChange, showDefaultAction }) => (
  <article
    className={cn(
      'rounded-lg border border-white/[0.08] bg-background-primary/45 px-2.5 py-2 shadow-sm transition-colors duration-150 hover:border-white/[0.16] hover:bg-background-primary/[0.62] focus-within:border-accent-hover focus-within:bg-accent-active/70',
      item.muted && 'opacity-70'
    )}
  >
    <div className="flex gap-2.5">
      <div
        className={cn(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-foreground-primary',
          item.isDefault && 'bg-accent-active text-accent-hover',
          item.muted && 'bg-state-error/10 text-state-error'
        )}
      >
        <span className="font-fluent text-base" aria-hidden="true">
          {itemIcon(item)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground-primary">
            {item.name}
          </h3>
          {(onMuteToggle || (showDefaultAction && onDefaultChange)) && (
            <div className="flex shrink-0 gap-1">
              {onMuteToggle && (
                <Button
                  type="button"
                  variant="transparent"
                  size="sm"
                  className="h-7 min-h-7 w-7 min-w-7 rounded-md border border-white/10 bg-white/[0.06] p-0 font-fluent text-[15px] text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary"
                  onClick={() => onMuteToggle(item.id)}
                  aria-label={item.muted ? `Unmute ${item.name}` : `Mute ${item.name}`}
                >
                  {itemIcon({ ...item, icon: undefined })}
                </Button>
              )}
              {showDefaultAction && onDefaultChange && (
                <Button
                  type="button"
                  variant={item.isDefault ? 'primary' : 'transparent'}
                  size="sm"
                  className={cn(
                    'h-7 min-h-7 w-7 min-w-7 rounded-md border border-white/10 bg-white/[0.06] p-0 font-fluent text-[15px] text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary',
                    item.isDefault &&
                      'border-accent-hover bg-accent-active text-accent-active-text hover:bg-accent-active'
                  )}
                  onClick={() => onDefaultChange(item.id)}
                  aria-label={
                    item.isDefault
                      ? `${item.name} is the default device`
                      : `Set ${item.name} as default`
                  }
                  aria-pressed={item.isDefault}
                >
                  {'\uE8FB'}
                </Button>
              )}
            </div>
          )}
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
  onMuteToggle,
  onDefaultChange,
  className,
}) => {
  const currentItems = items[activeTab] ?? [];
  const normalizedMaxVolume = Math.max(1, maxVolume);

  return (
    <section
      className={cn(panelVariants({ animated: !disableAnimations }), className)}
      aria-label="Audio mixer"
    >
      <div className="p-3">
        {currentItems.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-background-primary/30 p-8 text-center">
            <span className="font-fluent text-3xl text-foreground-tertiary/60" aria-hidden="true">
              {'\uE7F4'}
            </span>
            <p className="mt-3 text-sm font-medium text-foreground-secondary">No audio objects</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {currentItems.map((item) => (
              <AudioRow
                key={item.id}
                item={item}
                maxVolume={normalizedMaxVolume}
                onVolumeChange={onVolumeChange}
                onMuteToggle={onMuteToggle}
                onDefaultChange={onDefaultChange}
                showDefaultAction={activeTab === 'output' || activeTab === 'input'}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-white/[0.1] p-3">
        <nav
          className="flex gap-1 rounded-lg bg-background-primary/50 p-1"
          aria-label="Audio mixer tabs"
        >
          {tabs.map((tab) => (
            <Button
              key={tab}
              variant={tab === activeTab ? 'primary' : 'transparent'}
              size="sm"
              className={tabVariants({ animated: !disableAnimations })}
              onClick={() => onTabChange?.(tab)}
              aria-pressed={tab === activeTab}
            >
              <span className="font-fluent" aria-hidden="true">
                {tabMeta[tab].icon}
              </span>
              <span className="truncate">{tabMeta[tab].label}</span>
            </Button>
          ))}
        </nav>
      </footer>
    </section>
  );
};
