import type { InstallStatus } from '../api';
import { LandingPage } from './LandingPage';

export function LoginPage({
  status,
  onDone,
  initialMode = 'login'
}: {
  status?: InstallStatus;
  onDone: () => void;
  initialMode?: 'login' | 'register';
}) {
  return <LandingPage status={status} onDone={onDone} authMode="auth" initialMode={initialMode} />;
}
