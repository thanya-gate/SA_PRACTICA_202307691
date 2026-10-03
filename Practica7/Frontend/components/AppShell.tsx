import type { ReactNode } from 'react';
import { SiteHeader } from './SiteHeader';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="site-main">{children}</main>
    </div>
  );
}

export function PageIntro({
  caseId,
  title,
  description,
}: {
  caseId: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-intro">
      <p className="case-id">{caseId}</p>
      <h1>{title}</h1>
      <p className="page-description">{description}</p>
    </header>
  );
}

/**
 * Pie de contrato: declara el endpoint real que alimenta la vista. En la
 * Practica 8 cumple una segunda funcion, que es dejar visible en la interfaz
 * que los datos vienen de la VM y no de un simulador local.
 */
export function ContractNote({ children }: { children: ReactNode }) {
  return <p className="contract-note">{children}</p>;
}
