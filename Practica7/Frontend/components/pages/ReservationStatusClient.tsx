'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell, ContractNote, PageIntro } from '@/components/AppShell';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { StatusBadge } from '@/components/StatusBadge';
import { apiConfig, hostLegible } from '@/lib/config';
import { useSeguimientoReserva, type FaseSeguimiento } from '@/lib/use-seguimiento-reserva';
import type { ReservationStatus } from '@/lib/types';

const TITULOS: Record<ReservationStatus, string> = {
  PENDIENTE: 'Solicitud recibida',
  CONFIRMADA: 'Reserva confirmada',
  RECHAZADA: 'Reserva rechazada',
  SIN_CUPO: 'Sin cupo disponible',
};

const EXPLICACION: Record<FaseSeguimiento, string> = {
  idle: '',
  consultando: 'Consultando el estado en el productor…',
  esperando: 'En cola: el worker todavía no ha publicado el resultado.',
  resuelto: '',
  agotado: '',
};

export function ReservationStatusClient() {
  const searchParams = useSearchParams();
  const queryTrackingId = searchParams.get('trackingId') ?? '';
  const [campo, setCampo] = useState(queryTrackingId);
  const [trackingId, setTrackingId] = useState(queryTrackingId);
  /**
   * Al llegar por `/reservas?trackingId=...` el campo ya viene relleno, asi
   * que volver a buscar el MISMO identificador no cambia el estado. El
   * disparador obliga al hook a reiniciar el polling en ese caso.
   */
  const [disparador, setDisparador] = useState(0);
  const primeraCarga = useRef(true);

  const { fase, seguimiento, error, intentos, consultar } = useSeguimientoReserva(
    trackingId,
    true,
    disparador,
  );

  useEffect(() => {
    setCampo(queryTrackingId);
    setTrackingId(queryTrackingId);
    // El estado inicial ya nace con el valor de la query, asi que en el primer
    // render no hay nada que reiniciar: incrementar aqui duplicaria la consulta.
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    setDisparador((valor) => valor + 1);
  }, [queryTrackingId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTrackingId(campo.trim());
    setDisparador((valor) => valor + 1);
  }

  const cargando = fase === 'consultando';
  const enCola = fase === 'esperando' && seguimiento !== null;

  return (
    <AppShell>
      <section className="page-section">
        <PageIntro
          caseId="CU-P7-04"
          title="Consultar reserva"
          description="Ingresa el identificador de seguimiento para conocer el resultado del procesamiento asíncrono."
        />
        <form className="inline-query" onSubmit={submit}>
          <FormField
            id="reservation-id"
            label="Identificador de seguimiento"
            placeholder="trackingId devuelto al enviar la solicitud"
            value={campo}
            onChange={(input) => setCampo(input.target.value)}
          />
          <button className="button button--primary" type="submit" disabled={cargando}>
            {cargando ? 'Consultando…' : 'Consultar'}
          </button>
        </form>

        {cargando && <LoadingState label="Consultando el estado de la reserva…" />}
        {!cargando && fase === 'idle' && error && <ErrorState message={error} />}
        {!cargando && enCola && (
          <section className="panel result-card" aria-live="polite">
            <StatusBadge status="PENDIENTE" />
            <h2>Solicitud recibida</h2>
            <p>{seguimiento?.message}</p>
            <p className="panel-note">
              {EXPLICACION.esperando} Consultas realizadas: {intentos}.
            </p>
          </section>
        )}
        {!cargando && (fase === 'resuelto' || fase === 'agotado') && seguimiento && (
          <section className="panel result-card" aria-live="polite" aria-labelledby="reservation-result-title">
            <StatusBadge status={seguimiento.status} />
            <h2 id="reservation-result-title">{TITULOS[seguimiento.status]}</h2>
            <p>{seguimiento.message}</p>
            <hr />
            <dl className="result-details">
              <div><dt>Seguimiento</dt><dd>{seguimiento.trackingId}</dd></div>
              {seguimiento.reservationId && <div><dt>Reserva</dt><dd>{seguimiento.reservationId}</dd></div>}
              {seguimiento.processedAt && <div><dt>Procesada</dt><dd>{seguimiento.processedAt}</dd></div>}
            </dl>
            {seguimiento.ticket && (
              <div className="ticket-card">
                <h3>Pase emitido por el worker</h3>
                <p><strong>Código de validación:</strong> {seguimiento.ticket.validationCode}</p>
                <p><strong>Firma:</strong> {seguimiento.ticket.signature}</p>
                <p><strong>Titular:</strong> {seguimiento.ticket.holder}</p>
                <p><strong>Actividad:</strong> {seguimiento.ticket.eventTitle}</p>
                <p><strong>Emisión:</strong> {seguimiento.ticket.issuedAt}</p>
              </div>
            )}
          </section>
        )}
        {!cargando && fase === 'agotado' && (
          <div className="stack stack--small">
            {error && <ErrorState message={error} onRetry={consultar} />}
            {!seguimiento && (
              <button className="button button--secondary button--fit" type="button" onClick={consultar}>
                Volver a consultar
              </button>
            )}
          </div>
        )}

        <ContractNote>
          GET {hostLegible(apiConfig.reservas)}/api/reservas/&lt;trackingId&gt;/estado · lee la caché de seguimiento
          (Redis) mientras el worker procesa la cola; nunca consulta la base de datos desde el navegador.
        </ContractNote>
      </section>
    </AppShell>
  );
}