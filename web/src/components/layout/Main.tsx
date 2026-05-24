import type { ComponentPropsWithoutRef } from 'react';

type MainProps = ComponentPropsWithoutRef<'div'>;

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function Main({ className, ...props }: MainProps) {
  return <div className={classNames('app-main', className)} {...props} />;
}
