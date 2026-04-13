/* eslint-disable react-refresh/only-export-components */
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ScrollToTop } from './components/ScrollToTop.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import { CountryProvider } from './CountryContext.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const App = lazy(() => import('./App.tsx'))
const IndicatorPage = lazy(() => import('./components/IndicatorPage.tsx').then((module) => ({ default: module.IndicatorPage })))
const ApiDocsPage = lazy(() => import('./components/ApiDocsPage.tsx').then((module) => ({ default: module.ApiDocsPage })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <CountryProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
              <Routes>
                <Route path="/indicator/:id" element={<IndicatorPage />} />
                <Route path="/api-docs" element={<ApiDocsPage />} />
                <Route path="/:section?" element={<App />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </CountryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
