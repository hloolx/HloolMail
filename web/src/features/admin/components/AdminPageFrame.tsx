import type { ReactNode } from 'react';

type AdminPageFrameProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function AdminPageFrame({ title, description, actions, children }: AdminPageFrameProps) {
  return (
    <div className="admin-page grid gap-4">
      <div className="admin-page-header">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
