import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, UserCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const demoAccounts = [
  { username: 'junior1', password: 'suraksha@123' },
];

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ username: 'junior1', password: 'suraksha@123' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.username, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-hero">
        <div className="login-badge"><ShieldCheck size={18} /> Offline bank-grade verification</div>
        <h1>Suraksha 2.0</h1>
        <p>Document tampering detection, fraud analytics, and audit-safe underwriting intelligence running fully offline.</p>
        <div className="login-demo-list">
          {demoAccounts.map((account) => (
            <button key={account.username} className="demo-account" type="button" onClick={() => setForm(account)}>
              <UserCircle2 size={18} />
              <span>{account.username}</span>
              <small>verifier</small>
            </button>
          ))}
        </div>
      </section>

      <section className="login-panel">
        <h2>Officer Login</h2>
        <form onSubmit={handleSubmit} className="stack-form">
          <label>
            Username
            <input value={form.username} onChange={(e) => setForm((current) => ({ ...current, username: e.target.value }))} />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} />
          </label>
          {error ? <div className="inline-error">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Authenticating...' : 'Enter Workspace'}
          </button>
        </form>
      </section>
    </main>
  );
}
