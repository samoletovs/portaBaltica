import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { IndicatorPage } from './components/IndicatorPage.tsx'
import { ApiDocsPage } from './components/ApiDocsPage.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import { CountryProvider } from './CountryContext.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <CountryProvider>
          <BrowserRouter>
            <ScrollToTop />
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
