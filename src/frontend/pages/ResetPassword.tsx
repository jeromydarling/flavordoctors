import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { LogoMark } from '../components/Logo';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="flex justify-center">
        <LogoMark className="h-16 w-16" />
      </div>
      <h1 className="mt-4 text-center text-4xl font-black">New Password</h1>

      {done ? (
        <div className="rx-card mt-8 text-center">
          <p className="text-lg">✅</p>
          <p className="mt-2 font-bold">Password updated.</p>
          <Link to="/login" className="btn-rx mt-4 inline-block !py-2 !text-base">
            Sign in with your new password
          </Link>
        </div>
      ) : !token ? (
        <div className="rx-card mt-8 text-center">
          <p className="font-bold">This reset link is missing its token.</p>
          <Link to="/forgot-password" className="btn-outline mt-4 inline-block !py-2 !text-sm">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="rx-card mt-8 space-y-4">
          {error && <p className="rounded bg-red-500/20 p-3 text-sm text-red-300">{error}</p>}
          <div>
            <label htmlFor="new-password" className="mb-1 block font-bold">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-xs text-medical/60">At least 8 characters.</p>
          </div>
          <button type="submit" className="btn-rx w-full" disabled={busy}>
            {busy ? 'One moment…' : 'Set New Password'}
          </button>
        </form>
      )}
    </div>
  );
}
