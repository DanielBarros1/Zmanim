/**
 * App entry point.
 *
 * Sets up:
 *   - React 19 root
 *   - TanStack Query client (5-min stale, 3 retries on non-401)
 *   - BrowserRouter for client-side navigation
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry auth errors
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((error as any)?.response?.status === 401) return false
        return failureCount < 3
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
