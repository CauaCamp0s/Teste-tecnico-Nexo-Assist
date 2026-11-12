export default function LoadingPage() {
  return (
    <main className="page-state" role="status" aria-live="polite">
      <span className="state-mark" aria-hidden="true">
        N
      </span>
      <h1>Carregando atendimento…</h1>
      <p>Aguarde enquanto recuperamos suas informações.</p>
    </main>
  );
}
