export function AppLogo({ className = '' }: { className?: string }) {
  return <img className={`app-logo ${className}`.trim()} src="/brand-logo.svg" alt="" aria-hidden="true" draggable={false} />;
}
