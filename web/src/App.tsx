import { Routes, Route } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import AdminAccessGate from './auth/AdminAccessGate'
import HomePage from './pages/HomePage'
import AdminPortal from './pages/AdminPortal'
import PublicArtwork from './pages/PublicArtwork'
import HarewoodDriveDebtPage from './pages/HarewoodDriveDebt'
import TaskPulsePage from './pages/TaskPulsePage'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/artwork/:id" element={<PublicArtwork />} />
      <Route path="/harewood-drive" element={<HarewoodDriveDebtPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardPage />} />
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
    </Routes>
  )
}

export default App
