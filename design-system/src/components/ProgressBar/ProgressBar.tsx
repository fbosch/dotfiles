import type React from 'react';
import { cn } from '../../utils/cn';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  indeterminate?: boolean;
  variant?: 'primary' | 'error';
}

export const ProgressBar = ({
  value = 0,
  indeterminate = false,
  variant = 'primary',
  className,
  ...props
}: ProgressBarProps) => {
  const normalizedValue = Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn('h-2 overflow-hidden rounded-full bg-white/10', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : normalizedValue}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full',
          variant === 'error' ? 'bg-state-error' : 'bg-accent-primary',
          indeterminate
            ? 'w-1/3 animate-update-progress motion-reduce:animate-pulse'
            : 'transition-[width] duration-200'
        )}
        style={indeterminate ? undefined : { width: `${normalizedValue}%` }}
      />
    </div>
  );
};
