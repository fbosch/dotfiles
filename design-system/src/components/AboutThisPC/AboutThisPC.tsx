import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { Window } from '../Window';

export interface AboutThisPCInfo {
  deviceName: string;
  manufacturer?: string;
  deviceImageSrc?: string;
  deviceIcon?: string;
  processor?: string;
  memory?: string;
  desktop?: string;
  operatingSystem?: string;
}

export interface AboutThisPCProps {
  isOpen?: boolean;
  info: AboutThisPCInfo;
  onMoreInfo?: () => void;
  onClose?: () => void;
}

export const AboutThisPC = ({ isOpen = false, info, onMoreInfo, onClose }: AboutThisPCProps) => {
  const details = [
    ['Processor', info.processor],
    ['Memory', info.memory],
    ['Desktop', info.desktop],
    ['Operating system', info.operatingSystem],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      role="dialog"
      aria-hidden={!isOpen}
      aria-label="About This PC"
    >
      <Window showTitlebar={false} width="360px" height="520px">
        <div className="flex h-full flex-col items-center p-7 text-center">
          {info.deviceImageSrc ? (
            <img src={info.deviceImageSrc} alt="" className="h-44 w-full object-contain" />
          ) : (
            <span
              className="grid size-32 place-items-center rounded-lg bg-white/5 font-fluent text-6xl text-foreground-primary"
              aria-hidden="true"
            >
              {info.deviceIcon ?? '\uE7F8'}
            </span>
          )}
          <h2 className="mt-5 max-w-full truncate text-2xl font-semibold text-foreground-primary">
            {info.deviceName}
          </h2>
          {info.manufacturer && (
            <p className="mt-1 text-base text-foreground-tertiary">{info.manufacturer}</p>
          )}
          {details.length > 0 && (
            <dl className="mt-7 grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-right font-medium text-foreground-secondary">{label}</dt>
                  <dd className="truncate text-left text-foreground-primary" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {(onClose || onMoreInfo) && (
            <div className="mt-auto flex gap-2">
              {onClose && (
                <Button variant="transparent" onClick={onClose}>
                  Close
                </Button>
              )}
              {onMoreInfo && (
                <Button variant="default" onClick={onMoreInfo}>
                  More Info...
                </Button>
              )}
            </div>
          )}
        </div>
      </Window>
    </div>
  );
};
