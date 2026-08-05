import { useEffect, useState } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { Window } from '../Window';

export interface ForceQuitApplication {
  id: string;
  name: string;
  icon?: string;
  iconSrc?: string;
  cpu?: string;
  memory?: string;
}

export interface ForceQuitDialogProps {
  isOpen?: boolean;
  applications?: ForceQuitApplication[];
  status?: 'ready' | 'loading' | 'unavailable';
  unavailableMessage?: string;
  onForceQuit?: (applicationId: string) => void;
  onClose?: () => void;
}

export const ForceQuitDialog = ({
  isOpen = false,
  applications = [],
  status = 'ready',
  unavailableMessage = 'Running applications are unavailable right now.',
  onForceQuit,
  onClose,
}: ForceQuitDialogProps) => {
  const [selectedApplicationId, setSelectedApplicationId] = useState<string>();
  const selectedApplication = applications.find(
    (application) => application.id === selectedApplicationId
  );

  useEffect(() => {
    if (selectedApplicationId === undefined) return;
    if (isOpen && status === 'ready' && selectedApplication) return;

    setSelectedApplicationId(undefined);
  }, [isOpen, selectedApplication, selectedApplicationId, status]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isOpen}
      aria-label="Force Quit Applications"
    >
      <Window showTitlebar={false} width="420px" height="500px">
        <div className="flex h-full flex-col gap-4 p-5">
          <h2 className="text-center text-base font-semibold text-foreground-primary">
            Force Quit Applications
          </h2>
          {status === 'loading' && (
            <p className="flex flex-1 items-center justify-center text-sm text-foreground-tertiary">
              Loading running applications...
            </p>
          )}
          {status === 'unavailable' && (
            <p className="flex flex-1 items-center justify-center text-center text-sm text-foreground-tertiary">
              {unavailableMessage}
            </p>
          )}
          {status === 'ready' && applications.length === 0 && (
            <p className="flex flex-1 items-center justify-center text-sm text-foreground-tertiary">
              No running applications can be force quit.
            </p>
          )}
          {status === 'ready' && applications.length > 0 && (
            <div
              className="flex-1 overflow-y-auto rounded-lg border border-white/20 bg-background-primary/30 p-1"
              role="listbox"
              aria-label="Running applications"
            >
              {applications.map((application) => {
                const isSelected = application.id === selectedApplication?.id;

                return (
                  <button
                    key={application.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-150 focus-visible:outline-none',
                      isSelected
                        ? 'bg-accent-primary text-white'
                        : 'text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10'
                    )}
                    onClick={() => setSelectedApplicationId(application.id)}
                  >
                    {application.iconSrc ? (
                      <img src={application.iconSrc} alt="" className="size-6 rounded" />
                    ) : (
                      <span
                        className="grid size-6 place-items-center rounded bg-white/10 font-fluent text-xs"
                        aria-hidden="true"
                      >
                        {application.icon ?? '\uE71D'}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {application.name}
                    </span>
                    {(application.cpu || application.memory) && (
                      <span
                        className={cn(
                          'shrink-0 text-sm tabular-nums',
                          isSelected ? 'text-white/80' : 'text-foreground-tertiary'
                        )}
                      >
                        {[application.cpu, application.memory].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!selectedApplication || status !== 'ready'}
              onClick={() => selectedApplication && onForceQuit?.(selectedApplication.id)}
            >
              Force Quit
            </Button>
          </div>
        </div>
      </Window>
    </div>
  );
};
