import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} />
      <div className="app-main">
        <Header />
        <button className="sidebar-toggle" onClick={() => setCollapsed((value) => !value)} type="button">
          <Menu size={18} />
          <span>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
