import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import AdminAccessGate from './auth/AdminAccessGate'
import FinanceAccessGate from './auth/FinanceAccessGate'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'
import LoginPage from './pages/LoginPage'
// Legacy styles also serve private tools; keep their import independent of the public page.
import './App.css'

const AdminPortal = lazy(() => import('./pages/AdminPortal'))
const PublicArtwork = lazy(() => import('./pages/PublicArtwork'))
const HarewoodDriveDebtPage = lazy(() => import('./pages/HarewoodDriveDebt'))
const TaskPulsePage = lazy(() => import('./pages/TaskPulsePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const FinanceHubPage = lazy(() => import('./pages/FinanceHubPage'))
const AirbnbManagementPage = lazy(() => import('./pages/AirbnbManagementPage'))

function App() {
  return (
    <Suspense
      fallback={
        <main className="route-loading" role="status">
          Loading page…
        </main>
      }
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/artwork/:id" element={<PublicArtwork />} />
        <Route path="/harewood-drive" element={<HarewoodDriveDebtPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/dashboard/finance"
            element={
              <FinanceAccessGate>
                <FinanceHubPage />
              </FinanceAccessGate>
            }
          />
          <Route
            path="/dashboard/airbnb"
            element={
              <FinanceAccessGate
                area={{
                  eyebrow: 'Airbnb access',
                  title: 'Airbnb management',
                  setupDescription:
                    'The Airbnb dashboard helper or household access records are not available yet. Apply the Airbnb management migration, provision household membership, then retry.',
                }}
              >
                <AirbnbManagementPage />
              </FinanceAccessGate>
            }
          />
          <Route
            path="/manage-7f8a9c2e-4b3d-11ef-a8c9-0242ac130003"
            element={
              <AdminAccessGate title="Artwork admin">
                <AdminPortal />
              </AdminAccessGate>
            }
          />
          <Route
            path="/task-pulse"
            element={
              <AdminAccessGate title="Task Pulse">
                <TaskPulsePage />
              </AdminAccessGate>
            }
          />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

export default App
