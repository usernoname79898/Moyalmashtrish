import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import ServiceDetail from './pages/ServiceDetail';
import AdminLayout from './pages/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import SettingsPage from './pages/admin/SettingsPage';
import WorkLogs from './pages/admin/WorkLogs';
import DebtLedger from './pages/admin/DebtLedger';
import ProtectedRoute from './pages/admin/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/service/:id" element={<ServiceDetail />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="worklogs" replace />} />
        <Route path="worklogs" element={<WorkLogs lockedStatus="Tugallangan" />} />
        <Route path="debts" element={<DebtLedger />} />
        <Route path="queue" element={<WorkLogs lockedStatus="Jarayonda" />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
