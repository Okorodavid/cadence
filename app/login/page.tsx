"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/calendar";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.replace(next);
    else setError("Wrong password");
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm p-6">
      <h1 className="text-lg font-semibold">Cadence</h1>
      <p className="mt-1 mb-5 text-sm text-muted">Enter the workspace password.</p>
      <input
        type="password"
        className="input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-hot">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary mt-4 w-full">
        {busy ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-[70dvh] place-items-center">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
