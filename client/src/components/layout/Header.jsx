import { Bell, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Header() {
  const { user } = useAuth();

  return (
    <header className="topbar">
      <div className="search-box">
        <Search size={16} />
        <input type="search" placeholder="Search applications, customers, alerts" />
      </div>

      <div className="topbar-actions">
        <button className="icon-button" type="button" aria-label="Notifications">
          <Bell size={18} />
        </button>
        <div className="user-chip">
          <span className="user-chip-role">{user?.role?.replaceAll('_', ' ')}</span>
          <strong>{user?.name || 'Officer'}</strong>
        </div>
      </div>
    </header>
  );
}
