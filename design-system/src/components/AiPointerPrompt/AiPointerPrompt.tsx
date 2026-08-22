import type React from 'react';
import { useId } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../Button';

export type AiPointerPromptState =
  | { status: 'composing' }
  | { status: 'requesting' }
  | { status: 'answered'; answer: string; truncated?: boolean }
  | { status: 'error'; message: string };

export interface AiPointerPromptProps {
  value: string;
  state: AiPointerPromptState;
  onChange(value: string): void;
  onSubmit(question: string): void;
  onCancel(): void;
  className?: string;
}

export function AiPointerPrompt({
  value,
  state,
  onChange,
  onSubmit,
  onCancel,
  className,
}: AiPointerPromptProps): React.ReactElement {
  const inputId = useId();
  const composing = state.status === 'composing';
  const canSubmit = composing && value.trim().length > 0;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = value.trim();
    if (composing && question) onSubmit(question);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <div
      className={cn(
        'inline-flex max-w-[calc(100vw-2rem)] flex-col items-start font-button',
        className
      )}
    >
      <form
        className={cn(
          'flex h-12 w-fit max-w-full items-center gap-2 rounded-full border bg-background-secondary/80 p-2 shadow-[0_12px_36px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-colors duration-150',
          state.status === 'error'
            ? 'border-state-error/60'
            : 'border-white/15 focus-within:border-accent-primary/70'
        )}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
      >
        <label className="sr-only" htmlFor={inputId}>
          Ask about this
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          disabled={!composing}
          autoComplete="off"
          placeholder="Ask about this..."
          className="min-w-40 max-w-[22rem] bg-transparent pl-1 text-sm text-foreground-primary outline-none transition-[width] duration-150 [field-sizing:content] placeholder:text-foreground-tertiary disabled:cursor-default disabled:opacity-70"
          onChange={(event) => onChange(event.target.value)}
        />

        {composing ? (
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            aria-label="Send question"
            className="size-8 shrink-0 rounded-full p-0"
          >
            <SendIcon />
          </Button>
        ) : state.status === 'requesting' ? (
          <Button
            variant="primary"
            size="sm"
            aria-label="Cancel request"
            title="Cancel request"
            className="group size-8 shrink-0 rounded-full p-0 hover:bg-state-error hover:text-state-error-text focus-visible:bg-state-error focus-visible:text-state-error-text"
            onClick={onCancel}
          >
            <span className="group-hover:hidden group-focus-visible:hidden">
              <SpinnerIcon />
            </span>
            <span className="hidden group-hover:block group-focus-visible:block">
              <CloseIcon />
            </span>
          </Button>
        ) : (
          <Button
            variant="transparent"
            size="sm"
            aria-label="Close AI Pointer"
            className="size-8 shrink-0 rounded-full p-0"
            onClick={onCancel}
          >
            <CloseIcon />
          </Button>
        )}
      </form>

      {state.status === 'answered' ? (
        <section
          className="mt-2 max-h-64 w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl rounded-tl-md border border-white/15 bg-background-primary/95 px-4 py-3 shadow-[0_12px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl"
          aria-label="Answer"
        >
          <p className="whitespace-pre-wrap font-button text-sm leading-6 text-foreground-primary">
            {state.answer}
          </p>
          {state.truncated ? (
            <p className="mt-2 text-xs text-state-warning">Answer truncated to the local limit</p>
          ) : null}
        </section>
      ) : null}

      {state.status === 'error' ? (
        <div
          className="mt-2 flex w-[min(26rem,calc(100vw-2rem))] items-start gap-2 rounded-2xl rounded-tl-md border border-state-error/40 bg-background-primary/95 px-3 py-2.5 text-xs leading-relaxed text-state-error shadow-[0_12px_36px_rgba(0,0,0,0.24)] backdrop-blur-xl"
          role="alert"
        >
          <ErrorIcon />
          <span>{state.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M3 7.5h8M7.75 3.75l3.75 3.75-3.75 3.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="m3 3 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="7.5"
        cy="7.5"
        r="5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />
      <path
        d="M12.5 7.5a5 5 0 0 0-5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="mt-0.5 shrink-0"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M7 4.25v3.5M7 9.75v.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
