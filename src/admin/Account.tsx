import { useRef, useState } from 'preact/hooks';
import { changePassword, importBackup, loadProducts, session, type ApiError } from './api';
import { confirmDialog, Field, Icon, notify, PasswordInput, useLock } from './ui';

export function Account() {
  return (
    <>
      <div class="page-head">
        <h1>Configuración de cuenta</h1>
      </div>
      <PasswordPanel />
      <BackupPanel />
    </>
  );
}

function PasswordPanel() {
  const empty = { current: '', next: '', confirm: '' };
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lock = useLock();
  const set = (k: keyof typeof empty) => (v: string) => setValues((x) => ({ ...x, [k]: v }));

  async function change() {
    const found: Record<string, string> = {};
    if (!values.current) found.current = 'Escribe tu contraseña actual.';
    if (values.next.length < 10) found.next = 'Usa al menos 10 caracteres.';
    if (values.confirm !== values.next) found.confirm = 'Las contraseñas nuevas no coinciden.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await changePassword(values.current, values.next, values.confirm);
      setValues(empty);
      notify('Contraseña actualizada. Se han cerrado las demás sesiones.');
    } catch (err) {
      const { message, fields } = err as ApiError;
      setErrors(fields);
      notify(message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      class="panel panel--narrow"
      noValidate
      aria-labelledby="t-clave"
      onSubmit={(e) => {
        e.preventDefault();
        void lock(change);
      }}
    >
      <h2 id="t-clave">Cambiar contraseña</h2>
      <p class="muted">
        Usuario: <strong>{session.value?.username}</strong>
      </p>
      <input class="sr" tabIndex={-1} aria-hidden="true" autocomplete="username" readOnly value={session.value?.username} />
      <Field id="actual" label="Contraseña actual" error={errors.current}>
        <PasswordInput id="actual" autocomplete="current-password" value={values.current} invalid={!!errors.current} onInput={set('current')} />
      </Field>
      <Field id="nueva" label="Nueva contraseña" hint="Al menos 10 caracteres y sin tu nombre de usuario." error={errors.next}>
        <PasswordInput id="nueva" autocomplete="new-password" value={values.next} invalid={!!errors.next} onInput={set('next')} />
      </Field>
      <Field id="repite" label="Confirmar nueva contraseña" error={errors.confirm}>
        <PasswordInput id="repite" autocomplete="new-password" value={values.confirm} invalid={!!errors.confirm} onInput={set('confirm')} />
      </Field>
      <button type="submit" class="btn btn--primary" disabled={busy}>
        {busy && <span class="spinner" aria-hidden="true" />}
        {busy ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}

function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function restore(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('Ese archivo no es una copia de esta carta.');
      }
      const s = await importBackup(data, false);
      const ok = await confirmDialog({
        title: '¿Restaurar esta copia?',
        message: (
          <>
            <p>
              Los {s.current} productos actuales se sustituirán por los {s.products} de la copia: {s.published} publicados y {s.hidden} ocultos.
            </p>
            <p>Antes se guarda automáticamente una copia de lo que hay ahora.</p>
          </>
        ),
        confirmLabel: 'Restaurar copia',
        danger: true,
      });
      if (!ok) return;
      await importBackup(data, true);
      await loadProducts();
      notify('Copia restaurada.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section class="panel panel--narrow" aria-labelledby="t-copias">
      <h2 id="t-copias">Copias de seguridad</h2>
      <p class="muted">La copia incluye todos los productos, publicados y ocultos. Las fotos y los vídeos no van dentro: siguen en el servidor.</p>
      <div class="row">
        <a class="btn" href="/api/admin/export" download>
          <Icon name="download" />
          Descargar copia
        </a>
        <input ref={input} class="sr" type="file" tabIndex={-1} aria-hidden="true" accept="application/json,.json" onChange={(e) => restore(e.currentTarget.files?.[0])} />
        <button type="button" class="btn" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" />
          Restaurar copia
        </button>
      </div>
    </section>
  );
}
