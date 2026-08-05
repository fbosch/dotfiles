import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { Window } from '../Window';

const FLUENT_DESKTOP_ICON = '\uE7FB';

export interface AboutThisPCInfo {
  deviceName: string;
  manufacturer?: string;
  deviceImageSrc?: string;
  deviceIcon?: string;
  processor?: string;
  processorClock?: string;
  graphics?: string;
  memory?: string;
  memoryClock?: string;
  desktop?: string;
  operatingSystem?: string;
  kernel?: string;
  uptime?: string;
}

export interface AboutThisPCProps {
  isOpen?: boolean;
  info: AboutThisPCInfo;
  onMoreInfo?: () => void;
  onClose?: () => void;
}

export const AboutThisPC = ({ isOpen = false, info, onMoreInfo, onClose }: AboutThisPCProps) => {
  const processor = info.processor
    ? `${info.processor}${info.processorClock ? ` (${info.processorClock})` : ''}`
    : info.processorClock;
  const memory = info.memory
    ? `${info.memory}${info.memoryClock ? ` (${info.memoryClock})` : ''}`
    : info.memoryClock;
  const details = [
    ['CPU', processor],
    ['GPU', info.graphics],
    ['Memory', memory],
    ['Desktop', info.desktop],
    ['OS', info.operatingSystem],
    ['Kernel', info.kernel],
    ['Uptime', info.uptime],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isOpen}
      aria-label="About This PC"
    >
      <Window showTitlebar={false} width="420px" height="min(560px, calc(100vh - 32px))">
        <div className="relative flex h-full flex-col items-center px-8 py-7 text-center">
          {onClose && (
            <Button
              variant="transparent"
              size="sm"
              className="absolute right-3 top-3 size-8 p-0 font-fluent text-xs"
              aria-label="Close"
              onClick={onClose}
            >
              {'\uE711'}
            </Button>
          )}
          {info.deviceImageSrc ? (
            <img src={info.deviceImageSrc} alt="" className="h-36 w-full object-contain" />
          ) : (
            <span
              className="grid h-36 w-full place-items-center font-fluent text-7xl text-foreground-secondary"
              aria-hidden="true"
            >
              {info.deviceIcon ?? FLUENT_DESKTOP_ICON}
            </span>
          )}
          <h2 className="mt-3 max-w-full text-2xl font-semibold tracking-tight text-foreground-primary">
            {info.deviceName}
          </h2>
          {info.manufacturer && (
            <p className="mt-0.5 text-sm text-foreground-tertiary">{info.manufacturer}</p>
          )}
          {details.length > 0 && (
            <dl className="mt-6 grid w-full max-w-sm grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-3 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-right font-medium text-foreground-primary">{label}</dt>
                  <dd className="break-words text-left text-foreground-secondary" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {onMoreInfo && (
            <div className="mt-auto pt-6">
              <Button variant="default" onClick={onMoreInfo}>
                More Info...
              </Button>
            </div>
          )}
        </div>
      </Window>
    </div>
  );
};
