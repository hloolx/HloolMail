import type { ComponentPropsWithoutRef } from 'react';

type AppInsetProps = ComponentPropsWithoutRef<'main'> & {
  contentClassName?: string;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function AppInset({ children, className, contentClassName, ...props }: AppInsetProps) {
  return (
    <main className={classNames('app-inset', className)} {...props}>
      <div className={classNames('app-inset-content px-4 py-4 sm:px-6', contentClassName)}>
        {children}
      </div>
    </main>
  );
}
