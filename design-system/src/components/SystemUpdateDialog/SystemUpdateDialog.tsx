import { useId } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { Tag } from '../Tag';
import { Window } from '../Window';

const stepStatusMeta = {
  complete: { label: 'Complete', tagVariant: 'success' },
  'in-progress': { label: 'In progress', tagVariant: 'primary' },
  pending: { label: 'Pending', tagVariant: 'default' },
  failed: { label: 'Failed', tagVariant: 'danger' },
} as const;

export interface SystemUpdateStep {
  id: string;
  label: string;
  status: 'complete' | 'in-progress' | 'pending' | 'failed';
}

export interface SystemUpdateDialogProps {
  isOpen?: boolean;
  description?: string;
  progress?: number | 'indeterminate' | null;
  phase?: string;
  message?: string;
  errorMessage?: string;
  elapsedTime?: string;
  steps?: SystemUpdateStep[];
  currentGeneration?: string;
  currentGenerationDate?: string;
  technicalDetails?: string[];
  technicalDetailsOpen?: boolean;
  automaticallyCheckForUpdates?: boolean;
  onAutomaticallyCheckForUpdatesChange?: (checked: boolean) => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export const SystemUpdateDialog = ({
  isOpen = false,
  description = 'Building and activating the new system configuration.',
  progress = 0,
  phase = 'Preparing update...',
  message,
  errorMessage,
  elapsedTime,
  steps = [],
  currentGeneration,
  currentGenerationDate,
  technicalDetails = [],
  technicalDetailsOpen = false,
  automaticallyCheckForUpdates = true,
  onAutomaticallyCheckForUpdatesChange,
  primaryActionLabel,
  onPrimaryAction,
  onCancel,
  onClose,
}: SystemUpdateDialogProps) => {
  const titleId = useId();
  const elapsedTimeId = useId();
  const normalizedProgress =
    typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : progress;
  const hasWorkflowDetails = steps.length > 0 || technicalDetails.length > 0;
  let windowHeight = '360px';
  if (hasWorkflowDetails) windowHeight = 'min(640px, calc(100vh - 32px))';
  if (hasWorkflowDetails && errorMessage) windowHeight = 'min(680px, calc(100vh - 32px))';

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/15 p-4',
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isOpen}
      aria-labelledby={titleId}
    >
      <Window
        showTitlebar={false}
        width="min(920px, calc(100vw - 32px))"
        height={windowHeight}
        className="rounded-xl"
      >
        <div className="flex h-full flex-col text-foreground-primary">
          <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-4 pt-7">
            <header className="relative flex items-start gap-5 pr-10">
              <img
                src="/icons/nixos-snowflake.svg"
                alt=""
                className="shrink-0 object-contain"
                style={{ width: '68px', height: '68px' }}
              />
              <div className="min-w-0 pt-1">
                <h2 id={titleId} className="text-2xl font-semibold tracking-tight">
                  System update
                </h2>
                <p className="mt-1 text-base text-foreground-secondary">{description}</p>
              </div>
              {onClose && (
                <Button
                  variant="transparent"
                  size="sm"
                  className="size-9 p-0 font-fluent text-sm"
                  style={{ position: 'absolute', right: '-8px', top: '-8px' }}
                  aria-label="Close system update"
                  onClick={onClose}
                >
                  {'\uE711'}
                </Button>
              )}
            </header>

            <section className="mt-6" aria-label="Update progress">
              <div className="mb-2 flex items-end justify-between gap-4">
                <p className="text-lg font-semibold">{phase}</p>
                {typeof normalizedProgress === 'number' && (
                  <p className="shrink-0 text-lg tabular-nums text-foreground-secondary">
                    {Math.round(normalizedProgress)}%
                  </p>
                )}
              </div>
              {normalizedProgress !== null && (
                <div
                  className="h-2 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-label={phase}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    typeof normalizedProgress === 'number' ? normalizedProgress : undefined
                  }
                  aria-describedby={elapsedTime ? elapsedTimeId : undefined}
                >
                  <div
                    className={cn(
                      'h-full rounded-full',
                      errorMessage ? 'bg-state-error' : 'bg-accent-primary',
                      normalizedProgress === 'indeterminate'
                        ? 'w-1/3 animate-pulse'
                        : 'transition-[width] duration-200'
                    )}
                    style={
                      typeof normalizedProgress === 'number'
                        ? { width: `${normalizedProgress}%` }
                        : undefined
                    }
                  />
                </div>
              )}
              {(message || elapsedTime) && (
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-foreground-secondary">
                  {message && <p>{message}</p>}
                  {elapsedTime && (
                    <p id={elapsedTimeId} className="ml-auto tabular-nums">
                      Elapsed {elapsedTime}
                    </p>
                  )}
                </div>
              )}
              {errorMessage && (
                <div
                  className="mt-3 rounded-lg border border-state-error/35 bg-state-error/10 px-4 py-3 text-sm text-state-error"
                  role="alert"
                >
                  {errorMessage}
                </div>
              )}
            </section>

            {steps.length > 0 && (
              <ol className="mt-5 rounded-lg border border-white/10 bg-background-primary/25 px-4 py-2">
                {steps.map((step, index) => {
                  const isComplete = step.status === 'complete';
                  const isInProgress = step.status === 'in-progress';
                  const isFailed = step.status === 'failed';
                  const statusMeta = stepStatusMeta[step.status];

                  return (
                    <li
                      key={step.id}
                      className={cn(
                        'flex min-h-16 items-center',
                        index > 0 && 'border-t border-white/[0.06]'
                      )}
                      aria-current={isInProgress ? 'step' : undefined}
                    >
                      <span className="relative grid h-16 w-12 shrink-0 place-items-center">
                        {index < steps.length - 1 && (
                          <span
                            className="absolute left-1/2 top-12 h-10 border-l-2 border-dotted border-accent-primary/60"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            'relative z-10 grid size-9 shrink-0 place-items-center rounded-full border-2 bg-background-secondary text-sm font-semibold',
                            isComplete && 'border-state-success text-state-success',
                            isInProgress &&
                              'border-accent-primary bg-accent-primary/20 text-foreground-primary',
                            isFailed && 'border-state-error bg-state-error/10 text-state-error',
                            step.status === 'pending' && 'border-white/20 text-foreground-tertiary'
                          )}
                          aria-hidden="true"
                        >
                          {isComplete || isFailed ? (
                            <span className="font-fluent">{isComplete ? '\uE73E' : '\uEA39'}</span>
                          ) : (
                            index + 1
                          )}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-3 pl-3">
                        <span className="min-w-36 text-base font-semibold">{step.label}</span>
                        <Tag
                          variant={statusMeta.tagVariant}
                          className={cn(
                            'rounded-md px-2 py-1 text-xs font-semibold',
                            isComplete && 'bg-state-success/10 text-state-success',
                            isInProgress && 'bg-accent-primary/10 text-accent-hover',
                            isFailed && 'bg-state-error/10 text-state-error'
                          )}
                        >
                          {statusMeta.label}
                        </Tag>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {technicalDetails.length > 0 && (
              <details
                className="group mt-5 border-t border-white/10 pt-3"
                open={technicalDetailsOpen}
              >
                <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-md px-2 text-sm text-foreground-secondary transition-colors duration-150 hover:bg-white/[0.04] hover:text-foreground-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/30">
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="font-fluent text-base text-foreground-tertiary"
                      aria-hidden="true"
                    >
                      {'\uE787'}
                    </span>
                    <span className="font-semibold">Current:</span>
                    <span className="font-mono">
                      {[currentGeneration, currentGenerationDate].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 font-semibold">
                    Technical details
                    <span
                      className="font-fluent text-xs transition-transform duration-150 group-open:rotate-180"
                      aria-hidden="true"
                    >
                      {'\uE70D'}
                    </span>
                  </span>
                </summary>
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-white/15 bg-background-primary/30 px-5 py-4 font-mono text-sm leading-relaxed text-foreground-secondary">
                  {technicalDetails.join('\n')}
                </pre>
              </details>
            )}
          </div>

          <footer className="flex min-h-16 flex-col gap-3 border-t border-white/10 px-7 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-3 text-sm text-foreground-secondary">
              <input
                type="checkbox"
                className="size-4 accent-accent-primary"
                checked={automaticallyCheckForUpdates}
                onChange={(event) =>
                  onAutomaticallyCheckForUpdatesChange?.(event.currentTarget.checked)
                }
              />
              Automatically check for updates
            </label>
            <div className="flex justify-end gap-2">
              {onCancel && (
                <Button variant="outline" className="min-w-28" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              {primaryActionLabel && onPrimaryAction && (
                <Button variant="primary" className="min-w-28" onClick={onPrimaryAction}>
                  {primaryActionLabel}
                </Button>
              )}
            </div>
          </footer>
        </div>
      </Window>
    </div>
  );
};
