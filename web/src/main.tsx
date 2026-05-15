import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { installNetworkMonitor } from './utils/networkMonitor.ts'

// Wrap fetch/XHR/sendBeacon before any app code runs so the footer's
// privacy badge reflects real network activity rather than a static claim.
installNetworkMonitor()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
