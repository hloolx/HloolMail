import type { ComponentPropsWithoutRef } from 'react';

type AppFrameProps = ComponentPropsWithoutRef<'div'> & {
  collapsed?: boolean;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function AppFrame({ collapsed = false, className, ...props }: AppFrameProps) {
  return (
    <div
      className={classNames('app-frame', collapsed && 'app-frame-collapsed', className)}
      {...props}
    />
  );
}
