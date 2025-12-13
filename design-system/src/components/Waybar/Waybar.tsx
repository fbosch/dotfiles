import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';

const waybarVariants = cva(
  'flex items-center justify-between border-t border-border bg-background-secondary/70 backdrop-blur-sm shadow-[0_0_2px_rgba(0,0,0,0.3)] tracking-wide transition-colors duration-500',
  {
    variants: {
      position: {
        top: 'border-t-0 border-b',
        bottom: 'border-t',
      },
    },
    defaultVariants: {
      position: 'bottom',
    },
  }
);

const moduleVariants = cva('flex items-center gap-2 text-sm font-bold tracking-wide', {
  variants: {
    type: {
      cpu: '',
      memory: '',
      default: '',
    },
    state: {
      idle: 'text-state-success',
      normal: 'text-foreground-primary',
      warning: 'text-state-warning',
      critical: 'text-state-error',
    },
  },
  defaultVariants: {
    type: 'default',
    state: 'normal',
  },
});

const buttonVariants = cva(
  'border border-transparent rounded transition-all duration-150 ease-in-out',
  {
    variants: {
      variant: {
        start: 'text-foreground-tertiary text-2xl px-4 py-2 mx-1 hover:bg-white/10 hover:border-white/10 hover:text-foreground-primary',
        workspace: 'px-3 py-1 my-1 hover:bg-white/5 hover:border-white/10',
        workspaceActive: 'px-3 py-1 my-1 bg-white/5 border-white/10 font-bold',
        task: 'flex items-center gap-2 px-2 py-1 mx-1 rounded shadow-[1px_1px_rgba(0,0,0,0.5)] hover:bg-white/[0.01] hover:border-white/10',
        taskActive: 'flex items-center gap-2 px-2 py-1 mx-1 rounded shadow-[1px_1px_rgba(0,0,0,0.5)] bg-white/5 border-white/10 font-bold hover:bg-white/10',
        tray: 'ml-4',
      },
    },
    defaultVariants: {
      variant: 'start',
    },
  }
);

export interface WaybarProps extends VariantProps<typeof waybarVariants> {
  height?: number;
  className?: string;
}

export const Waybar: React.FC<WaybarProps> = ({ 
  position = 'bottom',
  height = 45,
  className,
}) => {
  return (
    <div 
      className={cn(waybarVariants({ position }), className)}
      style={{ height: `${height}px` }}
    >
      {/* Left modules */}
      <div className="flex items-center ml-1">
        <button type="button" className={buttonVariants({ variant: 'start' })}>
          󰣇
        </button>
        <div className="flex items-center gap-0">
          <button type="button" className={buttonVariants({ variant: 'workspace' })}>
            1
          </button>
          <button type="button" className={buttonVariants({ variant: 'workspaceActive' })}>
            2
          </button>
          <button type="button" className={buttonVariants({ variant: 'workspace' })}>
            3
          </button>
        </div>
      </div>

      {/* Center modules - Taskbar */}
      <div className="flex items-center flex-1 justify-center">
        <button type="button" className={buttonVariants({ variant: 'taskActive' })}>
          <span className="text-xl">󰈹</span>
          <span className="max-w-[200px] truncate">Firefox</span>
        </button>
        <button type="button" className={buttonVariants({ variant: 'task' })}>
          <span className="text-xl"></span>
          <span className="max-w-[200px] truncate">Terminal</span>
        </button>
        <button type="button" className={buttonVariants({ variant: 'task' })}>
          <span className="text-xl">󰨞</span>
          <span className="max-w-[200px] truncate">VS Code</span>
        </button>
      </div>

      {/* Right modules */}
      <div className="flex items-center gap-3 pr-1">
        <div className={cn(moduleVariants({ type: 'memory' }), 'ml-3')}>
          <span className="text-base"></span>
          <span>45%</span>
        </div>
        
        <div className={cn(moduleVariants({ type: 'cpu', state: 'idle' }), 'pr-3 border-r border-white/10')}>
          <span className="text-base"></span>
          <span>12%</span>
        </div>

        <div className="flex items-center gap-2 ml-3">
          <button type="button" className={buttonVariants({ variant: 'tray' })}>
            <span className="text-base">󰂯</span>
          </button>
          <button type="button" className={buttonVariants({ variant: 'tray' })}>
            <span className="text-base">󰖩</span>
          </button>
        </div>

        <div className="flex items-center mx-2">
          <span className="text-lg"></span>
        </div>

        <div className="text-xs">
          <span>ENG</span>
        </div>

        <div className="flex flex-col items-end text-xs px-2 ml-2 hover:bg-white/10 hover:rounded cursor-pointer">
          <span>14:23</span>
          <span>13/12/2025</span>
        </div>

        <div className="flex items-center">
          <span className="text-base">󰂚</span>
        </div>
      </div>
    </div>
  );
};
