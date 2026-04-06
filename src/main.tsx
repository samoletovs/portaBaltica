import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { IndicatorPage } from './components/IndicatorPage.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import { CountryProvider } from './CountryContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <CountryProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/indicator/:id" element={<IndicatorPage />} />
            <Route path="/:section?" element={<App />} />
          </Routes>
        </BrowserRouter>
      </CountryProvider>
    </ThemeProvider>
  </StrictMode>,
)
