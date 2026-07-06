import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, AlertTriangle, ScrollText, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Sidebar
 * -------
 * Left navigation rail. Branding block on top, nav links in the middle,
 * user chip + logout button anchored to the bottom via flex column.
 *
 * Logic & data flow unchanged.
 */

// High density structural items matching the mockup interface
const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/applications', label: 'Applications', icon: Users },
  { to: '/review-queue', label: 'Review queue', icon: AlertTriangle },
  { to: '/audit-log', label: 'Audit log', icon: ScrollText },
];

export default function Sidebar({ collapsed = false }) {
  const { user, logout } = useAuth();

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="brand-block">
        {/* Gold accent strictly isolated to the brand box container mark */}
        <div className="brand-mark">S</div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="brand-title truncate">Suraksha 2.0</div>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={16} className="flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User Profile & Logout anchored to the bottom */}
      <div className="flex-col gap-2" style={{ marginTop: 'auto' }}>
        {!collapsed && (
          <div
            className="p-3 border border-default rounded-md"
            style={{ backgroundColor: 'var(--surface-base)' }}
          >
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">
              {user?.role?.replaceAll('_', ' ') || 'Verifier'}
            </p>
            <p className="text-sm font-bold text-primary truncate" title={user?.name || 'Demo Officer'}>
              {user?.name || 'Demo Officer'}
            </p>
          </div>
        )}
        <button
          className="sidebar-logout w-full flex items-center justify-center gap-2"
          onClick={logout}
          type="button"
        >
          <LogOut size={16} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
