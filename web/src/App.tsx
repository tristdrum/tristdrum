import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import AdminPortal from './pages/AdminPortal'
import PublicArtwork from './pages/PublicArtwork'
import HarewoodDriveDebtPage from './pages/HarewoodDriveDebt'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/manage-7f8a9c2e-4b3d-11ef-a8c9-0242ac130003" element={<AdminPortal />} />
      <Route path="/artwork/:id" element={<PublicArtwork />} />
      <Route path="/harewood-drive" element={<HarewoodDriveDebtPage />} />
    </Routes>
  )
}

export default App
