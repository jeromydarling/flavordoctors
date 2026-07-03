import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogoMark } from '../components/Logo';

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/account';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="flex justify-center">
        <LogoMark className="h-16 w-16" />
      </div>
      <h1 className="mt-4 text-center text-4xl font-black">
        {mode === 'login' ? 'Patient Check-In' : 'New Patient Intake'}
      </h1>
      <p className="mt-2 text-center text-medical/60">
        {mode === 'login' ? 'Welcome back to the clinic.' : 'Register to manage orders and your Rx Box.'}
      </p>

      <form onSubmit={submit} className="rx-card mt-8 space-y-4">
        {error && <p className="rounded bg-red-500/20 p-3 text-sm text-red-300">{error}</p>}
        <div>
          <label htmlFor="email" className="mb-1 block font-bold">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block font-bold">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && <p className="mt-1 text-xs text-medical/60">At least 8 characters.</p>}
          {mode === 'login' && (
            <p className="mt-1 text-right text-sm">
              <Link to="/forgot-password" className="text-rx hover:underline">
                Forgot password?
              </Link>
            </p>
          )}
        </div>
        <button type="submit" className="btn-rx w-full" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      <p className="mt-6 text-center text-medical/70">
        {mode === 'login' ? 'New patient?' : 'Already registered?'}{' '}
        <button
          className="font-bold text-rx hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'Create an account' : 'Sign in instead'}
        </button>
      </p>
    </div>
  );
}
