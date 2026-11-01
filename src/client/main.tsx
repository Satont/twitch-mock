import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Controls } from './Controls';
import { Events } from './Events';
import { Rewards } from './Rewards';
import { Chat } from './Chat';
import { Icon, request } from './shared';
import './styles.css';

type Page = 'overview' | 'events' | 'rewards' | 'chat' | 'settings';

const pages: { id: Page; title: string; description: string; icon: string }[] = [
  {
    id: 'overview',
    title: 'Overview',
    description: 'Configure your mock channel and its current state',
    icon: 'dashboard',
  },
  {
    id: 'events',
    title: 'EventSub',
    description: 'Explore and trigger events for connected clients',
    icon: 'events',
  },
  {
    id: 'rewards',
    title: 'Channel Points',
    description: 'Manage rewards and simulate viewer redemptions',
    icon: 'rewards',
  },
  {
    id: 'chat',
    title: 'Chat simulator',
    description: 'Send messages and observe channel activity',
    icon: 'chat',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Configure account status and authorization failures',
    icon: 'settings',
  },
];

function getPage(): Page {
  if (location.pathname === '/admin/chat') return 'chat';
  const id = location.hash.slice(1);

  return pages.some((page) => page.id === id) ? (id as Page) : 'overview';
}

function App() {
  const [page, setPage] = useState<Page>(getPage),
    [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const handle = () => setPage(getPage());
    window.addEventListener('popstate', handle);
    window.addEventListener('hashchange', handle);

    return () => {
      window.removeEventListener('popstate', handle);
      window.removeEventListener('hashchange', handle);
    };
  }, []);
  useEffect(() => {
    request('/admin/state/stream')
      .then((value) => setOnline(Boolean(value.online)))
      .catch(() => setOnline(null));
  }, [page]);

  function navigate(next: Page) {
    const path =
      next === 'chat' ? '/admin/chat' : next === 'overview' ? '/admin' : `/admin#${next}`;

    history.pushState(null, '', path);
    setPage(next);
    window.scrollTo(0, 0);
  }

  const current = pages.find((item) => item.id === page)!;

  return (
    <div className="app-shell min-h-screen">
      <aside className="sidebar">
        <a
          className="brand"
          href="/admin"
          onClick={(e) => {
            e.preventDefault();
            navigate('overview');
          }}
          aria-label="TwitchMock home"
        >
          <span className="brand-mark">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 3.5h16v11l-4.2 4.2h-3.2L10 21v-2.3H6V6.5L4 8V3.5Z" fill="currentColor" />
              <path d="M10 7v5M15 7v5" stroke="#101011" strokeWidth="2" />
            </svg>
          </span>
          <span>
            Twitch<span className="brand-muted">Mock</span>
          </span>
        </a>
        <div className="side-label">Workspace</div>
        <nav className="navigation" aria-label="Main navigation">
          {pages.slice(0, 4).map((item) => (
            <a
              key={item.id}
              href={
                item.id === 'chat'
                  ? '/admin/chat'
                  : item.id === 'overview'
                    ? '/admin'
                    : `/admin#${item.id}`
              }
              className={page === item.id ? 'active' : ''}
              aria-label={item.title}
              title={item.title}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.id);
              }}
            >
              <Icon name={item.icon} />
              <span className="nav-label">{item.title}</span>
              <span className="nav-short" aria-hidden="true">
                {
                  (
                    {
                      overview: 'Overview',
                      events: 'Events',
                      rewards: 'Rewards',
                      chat: 'Chat',
                      settings: 'Settings',
                    } as Record<Page, string>
                  )[item.id]
                }
              </span>
            </a>
          ))}
        </nav>
        <div className="side-label side-spaced">Configuration</div>
        <nav className="navigation" aria-label="Configuration">
          <a
            href="/admin#settings"
            className={page === 'settings' ? 'active' : ''}
            aria-label="Settings"
            title="Settings"
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate('settings');
            }}
          >
            <Icon name="settings" />
            <span className="nav-label">Settings</span>
            <span className="nav-short" aria-hidden="true">
              Settings
            </span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="environment">
            <span className="environment-icon">
              <Icon name="events" size={16} />
            </span>
            <div>
              <strong>Mock environment</strong>
              <small>Safe to experiment</small>
            </div>
          </div>
          <p>Built for local development</p>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{current.title}</strong>
          </div>
          <div className="top-actions">
            <span className={`status-pill ${online ? 'live' : ''}`}>
              <i />
              {online === null ? 'Status unknown' : online ? 'Stream live' : 'Stream offline'}
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <h1>{current.title}</h1>
              <p>{current.description}</p>
            </div>
            {page === 'overview' && (
              <button className="heading-link" onClick={() => navigate('chat')}>
                Open chat <Icon name="arrow" size={16} />
              </button>
            )}
          </div>
          {page === 'overview' && (
            <div className="section-heading">
              <div>
                <h2>Channel state</h2>
                <p>Changes are reflected in the mock API</p>
              </div>
            </div>
          )}
          {(page === 'overview' || page === 'settings') && (
            <Controls key={page} tab={page} onStream={setOnline} />
          )}{' '}
          {page === 'events' && <Events />}
          {page === 'rewards' && <Rewards />}
          {page === 'chat' && <Chat />}
        </main>
        <footer className="footer">
          <span>TwitchMock</span>
          <span>Made for testing, not broadcasting</span>
        </footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
