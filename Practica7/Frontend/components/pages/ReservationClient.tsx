'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell, ContractNote, PageIntro } from '@/components/AppShell';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { ReservationSummary } from '@/components/ReservationSummary';
import { obtenerEvento, solicitarReserva, type EventoCompleto } from '@/lib/api/academix-api';
import { apiConfig, hostLegible } from '@/lib/config';

interface FormErrors {
  studentName?: string;
  studentEmail?: string;
}

/**
 * El productor acepta solo correos institucionales o de demostracion
 * (`dominioPermitido` en internal/domain/reserva.go del servicio de Go).
 * Se replica aqui para avisar antes de gastar un viaje de red, pero la regla
 * que manda sigue siendo la del backend.
 */
const DOMINIOS_ACEPTADOS = ['usac.edu.gt', 'demo.test'];

export function correoAceptado(correo: string): boolean {
  const partes = correo.trim().toLocaleLowerCase('es').split('@');
  if (partes.length !== 2) return false;
  return DOMINIOS_ACEPTADOS.some((dominio) => partes[1].endsWith(dominio));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Intenta nuevamente en unos momentos.';
}

export function ReservationClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventId = searchParams.get('eventId') ?? '';
  const [event, setEvent] = useState<EventoCompleto | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(Boolean(eventId));
  const [eventError, setEventError] = useState<string | null>(eventId ? null : 'No se indicó un evento válido.');
  const [studentName, setStudentName] = useState('Estudiante de prueba');
  const [studentEmail, setStudentEmail] = useState('estudiante@usac.edu.gt');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadEvent = useCallback(() => {
    if (!eventId) {
      setLoadingEvent(false);
      setEventError('No se indicó un evento válido.');
      return;
    }
    let active = true;
    setLoadingEvent(true);
    setEventError(null);
    void obtenerEvento(eventId)
      .then((result) => {
        if (active) setEvent(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setEvent(null);
          setEventError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (active) setLoadingEvent(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => loadEvent(), [loadEvent]);

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};
    if (!studentName.trim()) nextErrors.studentName = 'Ingresa el nombre completo.';
    else if (studentName.trim().length < 3) nextErrors.studentName = 'El nombre debe tener al menos 3 caracteres.';

    const correo = studentEmail.trim();
    if (!correo) nextErrors.studentEmail = 'Ingresa un correo electrónico.';
    else if (!/^\S+@\S+\.\S+$/.test(correo)) nextErrors.studentEmail = 'Ingresa un correo válido.';
    else if (!correoAceptado(correo)) {
      nextErrors.studentEmail = 'Usa un correo institucional (usac.edu.gt) o de demostración (demo.test).';
    }
    return nextErrors;
  }

  async function submit(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0 || !event) return;

    setSubmitting(true);
    try {
      /**
       * La respuesta es 202 Accepted: la solicitud ya esta en RabbitMQ y el
       * cupo lo decidira el worker. No hay boleto todavia, por eso lo que se
       * lleva a la siguiente pantalla es el identificador de seguimiento.
       */
      const aceptada = await solicitarReserva({
        eventId: event.eventId,
        studentName: studentName.trim(),
        studentEmail: studentEmail.trim(),
      });
      router.push(`/reservas?trackingId=${encodeURIComponent(aceptada.trackingId)}`);
    } catch (reason: unknown) {
      setSubmitError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="page-section">
        <Link className="back-link" href={eventId ? `/evento?eventId=${encodeURIComponent(eventId)}` : '/'}>← Volver al evento</Link>
        <PageIntro
          caseId="CU-P7-03"
          title="Solicitar reserva"
          description="Completa los datos de prueba y confirma el envío de tu solicitud."
        />
        <div className="stepper" aria-label="Pasos de la reserva">
          <span className="stepper__step stepper__step--active">1 Evento</span>
          <span aria-hidden="true">›</span>
          <span className="stepper__step">2 Datos</span>
          <span aria-hidden="true">›</span>
          <span className="stepper__step">3 Seguimiento</span>
        </div>

        {loadingEvent && <LoadingState label="Preparando la solicitud…" />}
        {!loadingEvent && eventError && (
          <div className="stack stack--small">
            <ErrorState message={eventError} onRetry={loadEvent} />
            <Link className="button button--secondary button--fit" href="/">Regresar al catálogo</Link>
          </div>
        )}
        {!loadingEvent && !eventError && event && (
          <div className="reservation-layout">
            <ReservationSummary event={event} />
            <form className="panel reservation-form" onSubmit={submit} noValidate>
              <h2>Datos del estudiante</h2>
              <FormField
                id="student-name"
                label="Nombre completo"
                value={studentName}
                onChange={(input) => setStudentName(input.target.value)}
                error={errors.studentName}
                autoComplete="name"
              />
              <FormField
                id="student-email"
                label="Correo electrónico"
                type="email"
                value={studentEmail}
                onChange={(input) => setStudentEmail(input.target.value)}
                error={errors.studentEmail}
                autoComplete="email"
              />
              <p className="panel-note">Solo se utilizan datos de prueba; no se implementa autenticación.</p>
              {submitError && <ErrorState message={submitError} />}
              <div className="form-actions">
                <Link className="button button--secondary" href={`/evento?eventId=${encodeURIComponent(event.eventId)}`}>
                  Cancelar
                </Link>
                <button className="button button--primary" type="submit" disabled={submitting || event.availableSeats === 0}>
                  {submitting ? 'Enviando a la cola…' : 'Enviar solicitud'}
                </button>
              </div>
            </form>
          </div>
        )}

        <ContractNote>
          POST {hostLegible(apiConfig.reservas)}/api/reservas → 202 Accepted. El cupo lo reclama el worker
          asíncrono; el navegador no publica en RabbitMQ.
        </ContractNote>
      </section>
    </AppShell>
  );
}