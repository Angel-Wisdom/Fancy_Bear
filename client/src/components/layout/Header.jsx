import { useAuth } from '../../context/AuthContext';

export default function Header() {
  const { user } = useAuth();

  return (
    <header className="topbar">
      <div className="search-placeholder-spacer" />

      <div className="topbar-actions">
        <div className="user-chip">
          <span className="user-chip-role">{user?.role?.replaceAll('_', ' ')}</span>
          <strong>{user?.name || 'Officer'}</strong>
        </div>
      </div>
    </header>
  );
}