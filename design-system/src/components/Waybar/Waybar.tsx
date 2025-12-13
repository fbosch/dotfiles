import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';

const waybarVariants = cva(
  'w-full flex items-center justify-between bg-waybar-bg text-white text-waybar-base tracking-waybar text-shadow-waybar transition-colors duration-500',
  {
    variants: {
      position: {
        top: 'border-b border-white/15',
        bottom: 'border-t border-white/15',
      },
    },
    defaultVariants: {
      position: 'bottom',
    },
  }
);

const moduleVariants = cva('flex items-center gap-2 text-waybar-sm font-bold tracking-waybar', {
  variants: {
    type: {
      cpu: 'border-r border-white/10 pr-3',
      memory: 'ml-3',
      default: '',
    },
    state: {
      idle: 'text-state-success',
      normal: 'text-white',
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
        start: 'text-white/40 text-waybar-xl px-[1.1rem] pl-waybar-3 py-0 m-waybar-2 text-shadow-none hover:bg-white/10 hover:border-white/10 hover:text-white',
        workspace: 'px-3 py-1 my-[0.3rem] mx-0 hover:bg-white/5 hover:border-white/10',
        workspaceActive: 'px-3 py-1 my-[0.3rem] mx-0 bg-white/5 border-white/10 font-bold',
        task: 'flex items-center gap-2 px-2 py-1 m-[0.3rem] rounded text-shadow-waybar-button hover:bg-white/[0.01] hover:border-white/10',
        taskActive: 'flex items-center gap-2 px-2 py-1 m-[0.3rem] rounded text-shadow-waybar-button bg-white/5 border-white/10 font-bold hover:bg-white/10',
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
          <span className="font-fluent"></span>
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
          <img src="/icons/firefox.svg" alt="Firefox" className="w-[22px] h-[22px]" />
          <span className="max-w-[200px] truncate">Firefox</span>
        </button>
        <button type="button" className={buttonVariants({ variant: 'task' })}>
          <img src="/icons/terminal.svg" alt="Terminal" className="w-[22px] h-[22px]" />
          <span className="max-w-[200px] truncate">Terminal</span>
        </button>
        <button type="button" className={buttonVariants({ variant: 'task' })}>
          <img src="/icons/visualstudiocode.svg" alt="VS Code" className="w-[22px] h-[22px]" />
          <span className="max-w-[200px] truncate">VS Code</span>
        </button>
      </div>

      {/* Right modules */}
      <div className="flex items-center gap-3 pr-1">
        <div className={cn(moduleVariants({ type: 'memory' }), 'ml-3')}>
          <span className="text-base font-fluent"></span>
          <span>45%</span>
        </div>
        
        <div className={cn(moduleVariants({ type: 'cpu', state: 'idle' }), 'pr-3 border-r border-white/10')}>
          <span className="text-base font-fluent"></span>
          <span>12%</span>
        </div>

        <div className="flex items-center gap-2 ml-3">
          <button type="button" className={buttonVariants({ variant: 'tray' })}>
            <span className="text-base font-fluent"></span>
          </button>
          <button type="button" className={buttonVariants({ variant: 'tray' })}>
            <span className="text-base font-fluent"></span>
          </button>
        </div>

        <div className="flex items-center mx-2">
          <span className="text-lg font-fluent"></span>
        </div>

        <div className="text-xs">
          <span>ENG</span>
        </div>

        <div className="flex flex-col items-end text-xs px-2 ml-2 hover:bg-white/10 hover:rounded cursor-pointer">
          <span>14:23</span>
          <span>13/12/2025</span>
        </div>

        <div className="flex items-center">
          <span className="text-base font-fluent"></span>
        </div>
      </div>
    </div>
  );
};
