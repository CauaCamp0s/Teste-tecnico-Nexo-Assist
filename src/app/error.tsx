"use client";
import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-state" role="alert">
      <span className="state-mark" aria-hidden="true">
        N
      </span>
      <h1>Não foi possível carregar esta página</h1>
      <p>
        Seus dados salvos continuam preservados. Tente novamente em instantes.
      </p>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
      <Link href="/">Voltar ao início</Link>
    </main>
  );
}
