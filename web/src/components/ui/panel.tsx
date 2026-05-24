import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type PanelPadding = 'none' | 'sm' | 'md' | 'lg';
export type PanelTone = 'default' | 'soft';

export interface PanelProps extends ComponentPropsWithoutRef<'section'> {
  padding?: PanelPadding;
  tone?: PanelTone;
}

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { className, padding = 'md', tone = 'default', ...props },
  ref
) {
  return <section ref={ref} className={cn('ui-panel', `ui-panel-padding-${padding}`, `ui-panel-${tone}`, className)} {...props} />;
});

export const PanelHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function PanelHeader(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('ui-panel-header', className)} {...props} />;
});

export const PanelTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function PanelTitle(
  { className, ...props },
  ref
) {
  return <h2 ref={ref} className={cn('ui-panel-title', className)} {...props} />;
});

export const PanelDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(function PanelDescription(
  { className, ...props },
  ref
) {
  return <p ref={ref} className={cn('ui-panel-description', className)} {...props} />;
});

export const PanelContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function PanelContent(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('ui-panel-content', className)} {...props} />;
});

export const PanelFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function PanelFooter(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('ui-panel-footer', className)} {...props} />;
});
