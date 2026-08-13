import { useId } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { ProgressBar } from '../ProgressBar';
import { Window } from '../Window';

const stepStatusMeta = {
  complete: 'Complete',
  'in-progress': 'In progress',
  pending: 'Pending',
  failed: 'Failed',
} as const;

export interface SystemUpdateStep {
  id: string;
  label: string;
  status: 'complete' | 'in-progress' | 'pending' | 'failed';
  duration?: string;
}

export interface SystemUpdateInput {
  name: string;
  currentRevision: string;
  newRevision: string;
  selected?: boolean;
}

export interface SystemUpdateDialogProps {
  isOpen?: boolean;
  description?: string;
  progress?: number | 'indeterminate' | null;
  progressIsEstimated?: boolean;
  summaryVariant?: 'default' | 'success';
  phase?: string;
  message?: string;
  errorMessage?: string;
  elapsedTime?: string;
  steps?: SystemUpdateStep[];
  availableUpdates?: SystemUpdateInput[];
  updatesCheckedAt?: string;
  onUpdateSelectionChange?: (inputName: string, selected: boolean) => void;
  onSelectAllUpdatesChange?: (selected: boolean) => void;
  currentGeneration?: string;
  currentGenerationDate?: string;
  technicalDetails?: string[];
  technicalDetailsOpen?: boolean;
  onCopyTechnicalDetails?: (output: string) => void;
  automaticallyCheckForUpdates?: boolean;
  onAutomaticallyCheckForUpdatesChange?: (checked: boolean) => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export const SystemUpdateDialog = ({
  isOpen = false,
  description,
  progress = 0,
  progressIsEstimated = false,
  summaryVariant = 'default',
  phase = 'Preparing update...',
  message,
  errorMessage,
  elapsedTime,
  steps = [],
  availableUpdates = [],
  updatesCheckedAt,
  onUpdateSelectionChange,
  onSelectAllUpdatesChange,
  currentGeneration,
  currentGenerationDate,
  technicalDetails = [],
  technicalDetailsOpen,
  onCopyTechnicalDetails,
  automaticallyCheckForUpdates = true,
  onAutomaticallyCheckForUpdatesChange,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  onCancel,
  onClose,
}: SystemUpdateDialogProps) => {
  const titleId = useId();
  const elapsedTimeId = useId();
  const normalizedProgress =
    typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : progress;
  const hasWorkflowDetails =
    steps.length > 0 || availableUpdates.length > 0 || technicalDetails.length > 0;
  const hasFailure = Boolean(errorMessage) || steps.some((step) => step.status === 'failed');
  const showTechnicalDetails = technicalDetailsOpen ?? hasFailure;
  const selectedUpdateCount = availableUpdates.filter((update) => update.selected ?? true).length;
  const allUpdatesSelected = selectedUpdateCount === availableUpdates.length;
  const someUpdatesSelected = selectedUpdateCount > 0 && allUpdatesSelected === false;
  const showProgressSummary = normalizedProgress !== null || steps.length === 0 || Boolean(message);
  let windowHeight = '320px';
  if (summaryVariant === 'success') windowHeight = '360px';
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
        width="min(782px, calc(100vw - 32px))"
        height={windowHeight}
        className="rounded-xl"
        contentOverflow={summaryVariant === 'success' ? 'hidden' : 'auto'}
      >
        <div className="flex h-full flex-col text-foreground-primary">
          <div
            className={cn(
              'min-h-0 flex-1 px-7 pb-4 pt-7',
              summaryVariant === 'success' ? 'overflow-hidden pb-6' : 'overflow-y-auto'
            )}
          >
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
                {(currentGeneration || currentGenerationDate) && (
                  <p className="mt-1 text-xs text-foreground-tertiary">
                    Current generation{' '}
                    {currentGeneration && (
                      <strong className="font-semibold">{currentGeneration}</strong>
                    )}
                    {currentGeneration && currentGenerationDate ? ' · ' : ''}
                    {currentGenerationDate}
                  </p>
                )}
                {description && (
                  <p className="mt-1 text-base text-foreground-secondary">{description}</p>
                )}
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

            {showProgressSummary && (
              <section
                className={cn(
                  'mt-6',
                  summaryVariant === 'success' &&
                    'mb-5 flex min-h-28 flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-background-primary/20 px-6 py-5 text-center'
                )}
                aria-label="Update progress"
              >
                {summaryVariant === 'success' && (
                  <span
                    className="mb-3 grid size-10 place-items-center rounded-full border-2 border-state-success bg-state-success/10 font-fluent text-base text-state-success"
                    aria-hidden="true"
                  >
                    {'\uE73E'}
                  </span>
                )}
                <div
                  className={cn(
                    'mb-2 flex items-end justify-between gap-4',
                    summaryVariant === 'success' && 'mb-0 justify-center'
                  )}
                >
                  <p
                    className={cn(
                      'text-lg font-semibold',
                      summaryVariant === 'success' && 'text-xl'
                    )}
                  >
                    {phase}
                  </p>
                  {typeof normalizedProgress === 'number' && (
                    <p className="shrink-0 text-lg tabular-nums text-foreground-secondary">
                      {progressIsEstimated ? '~' : ''}
                      {Math.round(normalizedProgress)}%
                    </p>
                  )}
                </div>
                {normalizedProgress !== null && (
                  <ProgressBar
                    value={typeof normalizedProgress === 'number' ? normalizedProgress : undefined}
                    indeterminate={normalizedProgress === 'indeterminate'}
                    variant={errorMessage ? 'error' : 'primary'}
                    aria-label={phase}
                    aria-describedby={elapsedTime ? elapsedTimeId : undefined}
                  />
                )}
                {(message || elapsedTime) && (
                  <div
                    className={cn(
                      'mt-2 flex flex-wrap justify-between gap-2 text-sm text-foreground-secondary',
                      summaryVariant === 'success' && 'justify-center'
                    )}
                  >
                    {message && <p>{message}</p>}
                    {elapsedTime && (
                      <p id={elapsedTimeId} className="ml-auto tabular-nums">
                        Elapsed {elapsedTime}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {availableUpdates.length > 0 && (
              <section className="mt-2" aria-label={`${availableUpdates.length} updates available`}>
                {updatesCheckedAt && (
                  <p className="mb-3 px-1 text-xs text-foreground-tertiary">
                    Checked {updatesCheckedAt}
                  </p>
                )}
                <div className="overflow-hidden rounded-lg border border-white/10 bg-background-primary/25">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-foreground-primary hover:bg-white/[0.06]">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent-primary"
                      checked={allUpdatesSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = someUpdatesSelected;
                      }}
                      onChange={(event) => onSelectAllUpdatesChange?.(event.currentTarget.checked)}
                    />
                    Select all inputs
                    <span className="ml-auto text-xs font-normal tabular-nums text-foreground-tertiary">
                      {selectedUpdateCount} of {availableUpdates.length} selected
                    </span>
                  </label>
                  <ul>
                    {availableUpdates.map((update, index) => (
                      <li
                        key={update.name}
                        className={cn(
                          'flex min-h-12 items-center gap-3 px-4 py-2',
                          index > 0 && 'border-t border-white/[0.06]'
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-accent-primary"
                          checked={update.selected ?? true}
                          aria-label={`Update ${update.name}`}
                          onChange={(event) =>
                            onUpdateSelectionChange?.(update.name, event.currentTarget.checked)
                          }
                        />
                        <span className="min-w-0 flex-1 text-sm font-semibold">{update.name}</span>
                        <span className="shrink-0 text-sm tabular-nums text-foreground-secondary">
                          {update.currentRevision} → {update.newRevision}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {steps.length > 0 && (
              <ol className="mt-5 rounded-lg border border-white/10 bg-background-primary/25 px-4 py-2">
                {steps.map((step, index) => {
                  const isComplete = step.status === 'complete';
                  const isInProgress = step.status === 'in-progress';
                  const isFailed = step.status === 'failed';
                  const statusLabel = stepStatusMeta[step.status];

                  return (
                    <li
                      key={step.id}
                      className={cn(
                        'flex min-h-16 items-center',
                        index > 0 && 'border-t border-white/[0.06]'
                      )}
                      aria-current={isInProgress ? 'step' : undefined}
                      aria-label={`${step.label}: ${statusLabel}${step.duration ? `, ${step.duration}` : ''}`}
                    >
                      <span className="relative grid h-16 w-12 shrink-0 place-items-center">
                        {index < steps.length - 1 && (
                          <span
                            className="absolute left-1/2 top-12 z-0 h-10 border-l-2 border-dotted border-white/20"
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
                          {isComplete ? (
                            <span className="font-fluent">{'\uE73E'}</span>
                          ) : isFailed ? (
                            <span className="font-fluent text-xs">{'\uE711'}</span>
                          ) : (
                            index + 1
                          )}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-4 pl-3">
                        <span className="min-w-0 text-base font-semibold">{step.label}</span>
                        {step.duration && (
                          <span className="shrink-0 text-right text-sm tabular-nums text-foreground-tertiary">
                            {step.duration}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {errorMessage && (
              <div
                className="mt-5 rounded-lg border border-state-error/35 bg-state-error/10 px-4 py-3 text-sm text-state-error"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            {technicalDetails.length > 0 && (
              <details
                className="group mt-5 border-t border-white/10 pt-2"
                open={showTechnicalDetails}
              >
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-md px-2 text-sm font-semibold text-foreground-secondary transition-colors duration-150 hover:bg-white/[0.04] hover:text-foreground-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/30">
                  Technical details
                  <span
                    className="ml-auto font-fluent text-xs transition-transform duration-150 group-open:rotate-180"
                    aria-hidden="true"
                  >
                    {'\uE70D'}
                  </span>
                </summary>
                <div className="relative mt-2">
                  {onCopyTechnicalDetails && (
                    <Button
                      variant="transparent"
                      size="sm"
                      className="absolute right-2 top-2 z-10 border border-white/15 bg-background-secondary/90 shadow-sm backdrop-blur-sm"
                      onClick={() => onCopyTechnicalDetails(technicalDetails.join('\n'))}
                    >
                      <span className="font-fluent" aria-hidden="true">
                        {'\uE8C8'}
                      </span>
                      Copy output
                    </Button>
                  )}
                  <pre
                    className={cn(
                      'max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-white/15 bg-background-primary/30 px-5 pb-4 font-mono text-sm leading-relaxed text-foreground-secondary',
                      onCopyTechnicalDetails ? 'pt-14' : 'pt-4'
                    )}
                  >
                    {technicalDetails.join('\n')}
                  </pre>
                </div>
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
                <Button variant="transparent" className="min-w-28" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              {secondaryActionLabel && onSecondaryAction && (
                <Button variant="default" className="min-w-28" onClick={onSecondaryAction}>
                  {secondaryActionLabel}
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
