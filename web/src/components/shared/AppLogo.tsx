export function AppLogo({ className = '', onClick }: { className?: string; onClick?: () => void }) {
  return <img className={`app-logo ${className}`.trim()} src="/brand-logo.svg" alt="" aria-hidden="true" draggable={false} onClick={onClick} />;
}
