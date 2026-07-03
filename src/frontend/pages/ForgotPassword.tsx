import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { LogoMark } from '../components/Logo';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/forgot', { email });
    } catch {
      // Same outcome either way — the endpoint never reveals account existence.
    }
    setSent(true);
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="flex justify-center">
        <LogoMark className="h-16 w-16" />
      </div>
      <h1 className="mt-4 text-center text-4xl font-black">Lost Your Chart?</h1>
      <p className="mt-2 text-center text-medical/60">We'll email you a link to reset your password.</p>

      {sent ? (
        <div className="rx-card mt-8 text-center">
          <p className="text-lg">💌</p>
          <p className="mt-2 font-bold">If that email has an account, a reset link is on its way.</p>
          <p className="mt-2 text-sm text-medical/60">The link works for one hour. Check spam if it hides.</p>
          <Link to="/login" className="btn-outline mt-4 inline-block !py-2 !text-sm">
            Back to check-in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="rx-card mt-8 space-y-4">
          <div>
            <label htmlFor="forgot-email" className="mb-1 block font-bold">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-rx w-full" disabled={busy}>
            {busy ? 'One moment…' : 'Send Reset Link'}
          </button>
          <p className="text-center text-sm text-medical/60">
            Remembered it?{' '}
            <Link to="/login" className="font-bold text-rx hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
