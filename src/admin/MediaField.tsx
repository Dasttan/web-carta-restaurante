import { useEffect, useRef, useState } from 'preact/hooks';
import { deleteMedia, getMedia, listMedia, options, uploadMedia, type ApiError, type MediaItem } from './api';
import { confirmDialog, Dialog, Icon, notify, Spinner } from './ui';

const ACCEPT = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm',
};

interface Props {
  label: string;
  kind: 'image' | 'video';
  value: MediaItem | null;
  hint: string;
  /** Imagen que se usaría si no se elige ninguna. */
  fallback?: string | null;
  onChange: (m: MediaItem | null) => void;
  onBusy: (delta: 1 | -1) => void;
}

export function MediaField({ label, kind, value, hint, fallback, onChange, onBusy }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      abort.current?.abort();
    },
    [],
  );

  const limit = options.value!.limits[kind === 'image' ? 'imageMb' : 'videoMb'];
  const noun = kind === 'image' ? 'la imagen' : 'el vídeo';

  async function upload(file: File | undefined) {
    if (!file || progress !== null) return;
    setError('');
    if (file.size > limit * 1048576) return setError(`El archivo es demasiado grande. El máximo es ${limit} MB.`);
    setProgress(0);
    onBusy(1);
    abort.current = new AbortController();
    try {
      let m = await uploadMedia(file, (r) => setProgress(r), abort.current.signal);
      setProgress(1);
      while (m.status === 'processing' && alive.current) {
        await new Promise((r) => setTimeout(r, 1200));
        m = await getMedia(m.id);
      }
      if (!alive.current) return;
      if (m.status === 'error') setError(m.error ?? 'El archivo no se puede usar.');
      else onChange(m);
    } catch (e) {
      if (alive.current) setError((e as ApiError).message);
    } finally {
      if (alive.current) {
        setProgress(null);
        onBusy(-1);
      }
      if (input.current) input.current.value = '';
    }
  }

  const preview = value ?? null;
  return (
    <div class="media-field">
      <h3>{label}</h3>
      <div
        class={`drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer?.files[0]);
        }}
      >
        {preview?.kind === 'video' ? (
          <video key={preview.id} src={preview.url ?? undefined} poster={preview.thumb ?? undefined} controls muted playsInline preload="none" />
        ) : preview ? (
          <img src={preview.url ?? undefined} alt={`Vista previa: ${label}`} />
        ) : fallback ? (
          <img class="is-fallback" src={fallback} alt="Imagen tomada del vídeo" />
        ) : (
          <span class="drop__empty">
            <Icon name={kind} />
            Arrastra {noun} aquí
          </span>
        )}
        {progress !== null && (
          <div class="drop__busy" role="status">
            <progress max={1} value={progress < 1 ? progress : undefined} />
            <span>{progress < 1 ? `Subiendo… ${Math.round(progress * 100)} %` : kind === 'video' ? 'Preparando el vídeo…' : 'Preparando la imagen…'}</span>
            {progress < 1 && (
              <button type="button" class="btn btn--small" onClick={() => abort.current?.abort()}>
                Cancelar subida
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p class="field__error" role="alert">
          {error}
        </p>
      )}
      <p class="field__hint">{hint}</p>
      <div class="media-field__actions">
        <input ref={input} class="sr" type="file" tabIndex={-1} aria-hidden="true" accept={ACCEPT[kind]} onChange={(e) => upload(e.currentTarget.files?.[0])} />
        <button type="button" class="btn btn--small" disabled={progress !== null} onClick={() => input.current?.click()}>
          <Icon name="upload" />
          {value ? 'Sustituir' : 'Subir'}
        </button>
        <button type="button" class="btn btn--small" disabled={progress !== null} onClick={() => setPicking(true)}>
          <Icon name={kind} />
          Elegir existente
        </button>
        {value && (
          <button type="button" class="btn btn--small btn--quiet-danger" disabled={progress !== null} onClick={() => onChange(null)}>
            <Icon name="close" />
            Quitar
          </button>
        )}
      </div>
      {picking && (
        <Picker
          kind={kind}
          label={label}
          selected={value?.id}
          onClose={() => setPicking(false)}
          onPick={(m) => {
            setPicking(false);
            setError('');
            onChange(m);
          }}
        />
      )}
    </div>
  );
}

interface PickerProps {
  kind: 'image' | 'video';
  label: string;
  selected?: string;
  onPick: (m: MediaItem) => void;
  onClose: () => void;
}
function Picker({ kind, label, selected, onPick, onClose }: PickerProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState('');
  const load = () => listMedia(kind).then((d) => setItems(d.media), (e: ApiError) => setError(e.message));
  useEffect(() => void load(), []);

  async function remove(m: MediaItem) {
    const ok = await confirmDialog({
      title: '¿Borrar este archivo?',
      message: `«${m.name}» no se usa en ningún producto. Se borrará definitivamente.`,
      confirmLabel: 'Borrar archivo',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMedia(m.id);
      await load();
    } catch (e) {
      notify((e as ApiError).message, true);
    }
  }

  return (
    <Dialog title={`${label}: elegir existente`} onClose={onClose}>
      {error && <p class="field__error">{error}</p>}
      {!items && !error && <Spinner label="Cargando…" />}
      {items?.length === 0 && <p>Todavía no hay archivos de este tipo.</p>}
      <ul class="picker">
        {items?.map((m) => (
          <li key={m.id}>
            <button type="button" class="picker__item" aria-pressed={m.id === selected} onClick={() => onPick(m)}>
              {m.thumb ? <img src={m.thumb} alt="" loading="lazy" /> : <Icon name={kind} />}
              <span class="picker__name">{m.name}</span>
              <small>{m.usedBy.length ? `En: ${m.usedBy.join(', ')}` : 'Sin usar'}</small>
            </button>
            {m.usedBy.length === 0 && m.id !== selected && (
              <button type="button" class="icon-btn picker__delete" aria-label={`Borrar ${m.name}`} onClick={() => remove(m)}>
                <Icon name="trash" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
