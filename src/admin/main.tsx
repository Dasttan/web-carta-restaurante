import './admin.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadSession, login, logout, restaurantName, session, type ApiError } from './api';
import { Account } from './Account';
import { ProductForm } from './ProductForm';
import { ProductList } from './ProductList';
import { BASE, dirty, go, linkTo, path } from './router';
import { ConfirmHost, confirmDialog, Field, Icon, Notices, notify, PasswordInput, Spinner, useLock, type IconName } from './ui';

function App() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = () => {
    setState('loading');
    loadSession().then(
      () => setState('ready'),
      () => setState('error'),
    );
  };
  useEffect(load, []);

  document.title = restaurantName.value ? `Panel · ${restaurantName.value}` : 'Panel';

  return (
    <>
      {state === 'loading' && (
        <div class="center">
          <Spinner label="Abriendo el panel…" />
        </div>
      )}
      {state === 'error' && (
        <div class="center">
          <p>No se ha podido conectar con el servidor.</p>
          <button type="button" class="btn btn--primary" onClick={load}>
            Reintentar
          </button>
        </div>
      )}
      {state === 'ready' && (session.value ? <Shell /> : <Login />)}
      <ConfirmHost />
      <Notices />
    </>
  );
}

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<{ user?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const lock = useLock();

  async function enter() {
    const m = {
      user: username.trim() ? undefined : 'Escribe tu usuario.',
      password: password ? undefined : 'Escribe tu contraseña.',
    };
    setMissing(m);
    setError('');
    if (m.user || m.password) return;
    setBusy(true);
    try {
      await login(username, password);
      void go(BASE, true);
    } catch (err) {
      setError((err as ApiError).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="login">
      <form
        class="login__card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void lock(enter);
        }}
      >
        <div class="login__brand">
          <img src="/brand/logotipo.svg" width="72" height="72" alt="" />
          <h1>{restaurantName.value}</h1>
          <p>Gestión de la carta</p>
        </div>
        {error && (
          <p class="alert" role="alert">
            <Icon name="alert" />
            {error}
          </p>
        )}
        <Field id="usuario" label="Usuario" error={missing.user}>
          <input
            id="usuario"
            autocomplete="username"
            autocapitalize="off"
            spellcheck={false}
            maxLength={100}
            aria-invalid={missing.user ? true : undefined}
            value={username}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
        </Field>
        <Field id="clave" label="Contraseña" error={missing.password}>
          <PasswordInput id="clave" autocomplete="current-password" value={password} invalid={!!missing.password} onInput={setPassword} />
        </Field>
        <button type="submit" class="btn btn--primary btn--wide" disabled={busy}>
          {busy ? <span class="spinner" aria-hidden="true" /> : null}
          {busy ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
    </main>
  );
}

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: BASE, label: 'Productos', icon: 'list' },
  { to: `${BASE}/nuevo`, label: 'Añadir producto', icon: 'plus' },
  { to: `${BASE}/cuenta`, label: 'Configuración de cuenta', icon: 'user' },
];

function Shell() {
  const here = path.value.replace(/\/$/, '') || BASE;

  async function leave() {
    if (dirty.value) {
      const ok = await confirmDialog({
        title: 'Hay cambios sin guardar',
        message: 'Si cierras la sesión ahora, se perderán.',
        confirmLabel: 'Cerrar sesión',
        cancelLabel: 'Seguir editando',
        danger: true,
      });
      if (!ok) return;
      dirty.value = false;
    }
    try {
      await logout();
      location.assign(`${BASE}/login`);
    } catch (e) {
      notify((e as ApiError).message, true);
    }
  }

  return (
    <div class="shell">
      <a class="skip" href="#contenido">
        Saltar al contenido
      </a>
      <header class="side">
        <a class="side__brand" {...linkTo(BASE)}>
          <img src="/brand/logotipo.svg" width="36" height="36" alt="" />
          <span>{restaurantName.value}</span>
        </a>
        <nav aria-label="Panel" class="side__nav">
          {NAV.map((n) => (
            <a key={n.to} {...linkTo(n.to)} aria-current={here === n.to ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
          <a href="/" target="_blank" rel="noopener">
            <Icon name="external" />
            <span>Ver carta pública</span>
          </a>
          <button type="button" onClick={leave}>
            <Icon name="exit" />
            <span>Cerrar sesión</span>
          </button>
        </nav>
      </header>
      <main id="contenido" class="content" tabIndex={-1}>
        {session.value?.mustChange && here !== `${BASE}/cuenta` && (
          <p class="alert alert--warn">
            <Icon name="alert" />
            <span>
              Estás usando la contraseña de desarrollo. <a {...linkTo(`${BASE}/cuenta`)}>Cámbiala</a> antes de publicar la web.
            </span>
          </p>
        )}
        <Screen here={here} />
      </main>
    </div>
  );
}

function Screen({ here }: { here: string }) {
  if (here === BASE || here === `${BASE}/login`) return <ProductList />;
  if (here === `${BASE}/nuevo`) return <ProductForm key="nuevo" />;
  if (here === `${BASE}/cuenta`) return <Account />;
  const edit = here.match(/^\/superuser\/producto\/([\w-]+)$/);
  if (edit) return <ProductForm key={edit[1]} id={edit[1]} />;
  return (
    <div class="empty">
      <h1>Esta página no existe</h1>
      <a class="btn btn--primary" {...linkTo(BASE)}>
        Ir a los productos
      </a>
    </div>
  );
}

render(<App />, document.getElementById('panel')!);
