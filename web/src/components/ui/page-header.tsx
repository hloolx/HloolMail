import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(function PageHeader(
  { className, eyebrow, title, description, actions, children, ...props },
  ref
) {
  return (
    <div ref={ref} className={cn('ui-page-header', className)} {...props}>
      <div className="ui-page-header-copy">
        {eyebrow ? <div className="ui-page-header-eyebrow">{eyebrow}</div> : null}
        {title ? <h1 className="ui-page-header-title">{title}</h1> : null}
        {description ? <p className="ui-page-header-description">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </div>
  );
});
