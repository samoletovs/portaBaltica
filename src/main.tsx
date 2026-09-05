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
import { DASHBOARD_SECTIONS } from './sections.ts'

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
const FollowPage = lazy(() => import('./components/news/FollowPage.tsx'))
const WeeklyPage = lazy(() => import('./components/news/WeeklyPage.tsx'))
const BriefingsPage = lazy(() => import('./components/news/BriefingsPage.tsx'))

const LEGACY_SECTIONS: ReadonlySet<string> = new Set(DASHBOARD_SECTIONS)

/**
 * The dashboard used to live at `/economy`, `/maritime` and so on. Those URLs
 * are in people's history and in a year of shared links, so they redirect to
 * their new home under `/data` rather than 404.
 */
function LegacySectionRedirect() {
  const { section } = useParams<{ section: string }>()
  if (section && LEGACY_SECTIONS.has(section)) {
    return <Navigate to={`/data/${section}`} replace />
  }
  return <Navigate to="/" replace />
}

/** Old correspondent URLs keep working, and land on the same person. */
function LegacyCorrespondentRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={id ? `/newsroom/${id}` : '/newsroom'} replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <CountryProvider>
          <FilterProvider>
            <BrowserRouter>
              <ScrollToTop />
              <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--bg-page)' }} />}>
                <Routes>
                  <Route element={<SiteLayout />}>
                    <Route element={<NewsroomLayout />}>
                      <Route index element={<NewsFeed />} />
                      <Route path="/article/:slug" element={<ArticlePage />} />
                      <Route path="/newsroom" element={<CorrespondentPage />} />
                      <Route path="/newsroom/:id" element={<CorrespondentPage />} />
                      {/* The masthead used to live at /correspondents. Those URLs
                          are in shared links and in search results, so they move
                          rather than break. */}
                      <Route path="/correspondents" element={<Navigate to="/newsroom" replace />} />
                      <Route path="/correspondents/:id" element={<LegacyCorrespondentRedirect />} />
                      <Route path="/about/ai" element={<AiPolicyPage />} />
                      <Route path="/corrections" element={<CorrectionsPage />} />
                      {/* How to keep up, and the one artefact worth coming back
                          for. `/weekly` is a stable address for whatever the
                          latest weekly review is, so a bookmark keeps working
                          when the article behind it changes. */}
                      <Route path="/follow" element={<FollowPage />} />
                      <Route path="/weekly" element={<WeeklyPage />} />
                      <Route path="/briefings" element={<BriefingsPage />} />
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
