import { cva } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';

const toggleOptionVariants = cva(
  'grid size-8 place-items-center rounded-full text-base focus-visible:outline-none active:scale-[0.98]',
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

export interface TripleToggleOption<Value extends string = string> {
  value: Value;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  ariaLabel?: string;
  title?: string;
}

export interface TripleToggleProps<Value extends string = string> {
  options: readonly TripleToggleOption<Value>[];
  value: Value;
  ariaLabel: string;
  onValueChange?: (value: Value) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  tabIndex?: number;
  animated?: boolean;
  className?: string;
}

export const TripleToggle = <Value extends string>({
  options,
  value,
  ariaLabel,
  onValueChange,
  onKeyDown,
  tabIndex,
  animated = true,
  className,
}: TripleToggleProps<Value>) => {
  return (
    <fieldset className={cn('w-48', className)}>
      <legend className="sr-only">{ariaLabel}</legend>
      <div className="flex items-center justify-between rounded-full bg-background-primary/50 p-1">
        {options.map((option) => {
          const active = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              tabIndex={tabIndex}
              className={toggleOptionVariants({ active, animated })}
              onClick={() => onValueChange?.(option.value)}
              onKeyDown={onKeyDown}
              aria-pressed={active}
              aria-label={option.ariaLabel ?? option.label}
              title={option.title}
              data-triple-toggle-option
            >
              <span className="relative grid place-items-center" aria-hidden="true">
                {option.icon}
                {option.badge}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between px-1 text-center text-xs font-medium text-foreground-primary">
        {options.map((option) => (
          <span key={option.value} className="w-8 shrink-0 whitespace-nowrap">
            {option.label}
          </span>
        ))}
      </div>
    </fieldset>
  );
};
