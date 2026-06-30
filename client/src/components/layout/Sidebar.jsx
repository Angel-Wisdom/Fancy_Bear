import { NavLink } from 'react-router-dom';
import { FileSearch, LayoutDashboard, Layers3, Landmark, LogOut, ScanLine, ScrollText, Upload, FileBarChart2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'Upload & Verify', icon: Upload },
  { to: '/results', label: 'Verification', icon: FileSearch },
  { to: '/financial', label: 'Financial Analysis', icon: FileBarChart2 },
  { to: '/land-records', label: 'Land Records', icon: Landmark },
  { to: '/reports', label: 'Reports', icon: Layers3 },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText },
  { to: '/aadhaar-verify', label: 'Aadhaar Verify', icon: ScanLine },
];

export default function Sidebar({ collapsed = false }) {
  const { logout } = useAuth();

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="brand-block">
        <div className="brand-mark">S2</div>
        <div>
          <div className="brand-title">Suraksha 2.0</div>
          <div className="brand-subtitle">Offline verification stack</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <button className="sidebar-logout" onClick={logout} type="button">
        <LogOut size={18} />
        <span>Logout</span>
      </button>
    </aside>
  );
}
