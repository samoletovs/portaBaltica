import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { IndicatorPage } from './components/IndicatorPage.tsx'
import { ApiDocsPage } from './components/ApiDocsPage.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import { CountryProvider } from './CountryContext.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <CountryProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/indicator/:id" element={<IndicatorPage />} />
              <Route path="/api-docs" element={<ApiDocsPage />} />
              <Route path="/:section?" element={<App />} />
            </Routes>
          </BrowserRouter>
        </CountryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
