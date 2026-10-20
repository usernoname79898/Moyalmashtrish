import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import ServiceDetail from './pages/ServiceDetail';
import AdminLayout from './pages/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import SettingsPage from './pages/admin/SettingsPage';
import WorkLogs from './pages/admin/WorkLogs';
import DebtLedger from './pages/admin/DebtLedger';
import QueuePage from './pages/admin/QueuePage';
import CustomersPage from './pages/admin/CustomersPage';
import VehiclesPage from './pages/admin/VehiclesPage';
import MastersPage from './pages/admin/MastersPage';
import StatisticsPage from './pages/admin/StatisticsPage';
import ServicesPage from './pages/admin/ServicesPage';
import AppointmentsPage from './pages/admin/AppointmentsPage';
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
        <Route path="queue" element={<QueuePage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="masters" element={<MastersPage />} />
        <Route path="statistics" element={<StatisticsPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="debts" element={<DebtLedger />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
