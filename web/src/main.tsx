import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { createAppQueryClient } from './lib/queryClient';
import { initMonitoring } from './lib/monitoring';
import { startWebVitals } from './lib/webVitals';
import './styles/index.css';

const queryClient = createAppQueryClient();

// Kick off monitoring as early as possible; vitals start after setup settles.
void initMonitoring().finally(() => {
  startWebVitals();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
