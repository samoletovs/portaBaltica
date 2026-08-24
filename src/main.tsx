/* eslint-disable react-refresh/only-export-components */
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import './index.css'
import { ScrollToTop } from './components/ScrollToTop.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import { CountryProvider } from './CountryContext.tsx'
import { FilterProvider } from './FilterContext.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { NewsroomLayout } from './components/news/NewsroomLayout.tsx'
import { SiteLayout } from './components/SiteLayout.tsx'

// The dashboard and everything chart-shaped stays behind a lazy boundary so
// recharts and d3 never load for a reader who only came for the front page.
const App = lazy(() => import('./App.tsx'))
const IndicatorPage = lazy(() => import('./components/IndicatorPage.tsx').then((module) => ({ default: module.IndicatorPage })))
const ApiDocsPage = lazy(() => import('./components/ApiDocsPage.tsx').then((module) => ({ default: module.ApiDocsPage })))

const NewsFeed = lazy(() => import('./components/news/NewsFeed.tsx'))
const ArticlePage = lazy(() => import('./components/news/ArticlePage.tsx'))
const CorrespondentPage = lazy(() => import('./components/news/CorrespondentPage.tsx'))
const AiPolicyPage = lazy(() => import('./components/news/AiPolicyPage.tsx'))
const CorrectionsPage = lazy(() => import('./components/news/CorrectionsPage.tsx'))

const DASHBOARD_SECTIONS = new Set([
  'economy', 'trade', 'government', 'labour', 'energy',
  'property', 'environment', 'business', 'maritime',
])

/**
 * The dashboard used to live at `/economy`, `/maritime` and so on. Those URLs
 * are in people's history and in a year of shared links, so they redirect to
 * their new home under `/data` rather than 404.
 */
function LegacySectionRedirect() {
  const { section } = useParams<{ section: string }>()
  if (section && DASHBOARD_SECTIONS.has(section)) {
    return <Navigate to={`/data/${section}`} replace />
  }
  return <Navigate to="/" replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <CountryProvider>
          <FilterProvider>
            <BrowserRouter>
              <ScrollToTop />
              <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
                <Routes>
                  <Route element={<SiteLayout />}>
                    <Route element={<NewsroomLayout />}>
                      <Route index element={<NewsFeed />} />
                      <Route path="/article/:slug" element={<ArticlePage />} />
                      <Route path="/correspondents" element={<CorrespondentPage />} />
                      <Route path="/correspondents/:id" element={<CorrespondentPage />} />
                      <Route path="/about/ai" element={<AiPolicyPage />} />
                      <Route path="/corrections" element={<CorrectionsPage />} />
                    </Route>
                    <Route path="/data/:section?" element={<App />} />
                    <Route path="/indicator/:id" element={<IndicatorPage />} />
                    <Route path="/api-docs" element={<ApiDocsPage />} />
                    <Route path="/:section" element={<LegacySectionRedirect />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </FilterProvider>
        </CountryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
