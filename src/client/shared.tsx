import { useState, type ReactNode, type FormEvent } from 'react';

export type Json = Record<string, any>;

export async function request<T = Json>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

  return data as T;
}

export function useNotice() {
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);

  async function run(fn: () => Promise<unknown>, success: string) {
    setNotice(null);

    try {
      await fn();
      setNotice({ text: success });

      return true;
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : String(error),
        error: true,
      });

      return false;
    }
  }

  return { notice, setNotice, run };
}

export function Notice({ value }: { value: { text: string; error?: boolean } | null }) {
  return value ? (
    <p
      role={value.error ? 'alert' : 'status'}
      className={value.error ? 'notice error' : 'notice success'}
    >
      {value.text}
    </p>
  ) : null;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Panel({
  title,
  description,
  children,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Button({
  children,
  secondary,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button ${secondary ? 'secondary' : ''} ${danger ? 'danger' : ''} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Form({
  children,
  onSubmit,
  className = '',
}: {
  children: ReactNode;
  onSubmit: () => unknown | Promise<unknown>;
  className?: string;
}) {
  return (
    <form
      className={className}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {children}
    </form>
  );
}

const paths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  events: (
    <>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </>
  ),
  rewards: (
    <>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8v13M3 12h18M12 8H8a2.5 2.5 0 1 1 2.3-3.5L12 8Zm0 0h4a2.5 2.5 0 1 0-2.3-3.5L12 8Z" />
    </>
  ),
  chat: (
    <>
      <path d="M20 11.5a8 8 0 0 1-8 8 8.5 8.5 0 0 1-3.4-.7L4 20l1.2-4.4A8 8 0 1 1 20 11.5Z" />
      <path d="M8 11h8M8 14h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m19.4 15 .1.1 1 1.6-1.8 1.8-1.6-1a8 8 0 0 1-1.5.6l-.4 1.9h-2.5l-.4-1.9a8 8 0 0 1-1.5-.6l-1.6 1-1.8-1.8 1-1.6a8 8 0 0 1-.6-1.5L4 13.2v-2.5l1.9-.4a8 8 0 0 1 .6-1.5l-1-1.6 1.8-1.8 1.6 1a8 8 0 0 1 1.5-.6L10.8 4h2.5l.4 1.9a8 8 0 0 1 1.5.6l1.6-1 1.8 1.8-1 1.6a8 8 0 0 1 .6 1.5l1.9.4v2.5l-1.9.4a8 8 0 0 1-.6 1.4Z" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14M14 7l5 5-5 5" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
