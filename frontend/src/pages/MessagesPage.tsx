import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DateChip } from '../components/DateChip';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { truncate } from '../lib/format';
import { useResource } from '../lib/useResource';

/** The inbox: existing conversations plus a list of people you can start one with. */
export function MessagesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Messages | Product Vault';
  }, []);

  // Logged-out users can't have conversations, so send them to log in and come back here.
  useEffect(() => {
    if (!user) navigate('/login', { replace: true, state: { from: '/messages' } });
  }, [user, navigate]);

  // Load the inbox: the threads and the directory of other users, together.
  const { state, reload } = useResource(
    () => Promise.all([api.listThreads(), api.listMessageUsers()]),
    [user?.id],
  );

  if (!user) return null;

  if (state.status === 'loading') return <Loading>Loading messages…</Loading>;

  if (state.status === 'error') {
    return (
      <ErrorNotice
        title="Messages couldn’t be loaded."
        detail={state.error.message}
        action={
          <button className="button button--secondary" type="button" onClick={reload}>
            Try again
          </button>
        }
      />
    );
  }

  const [threads, people] = state.data;
  // People you don't already have a thread with, so "Start a conversation" doesn't repeat them.
  const partnersWithThread = new Set(threads.map((thread) => thread.partnerId));
  const newContacts = people.filter((person) => !partnersWithThread.has(person.id));

  return (
    <section aria-labelledby="messages-heading">
      <div className="page-header">
        <h1 id="messages-heading" className="page-title">
          Messages
        </h1>
      </div>

      <section className="messages-section" aria-labelledby="threads-heading">
        <div className="section-header">
          <h2 id="threads-heading" className="section-header__title">
            Conversations
          </h2>
        </div>
        {threads.length === 0 ? (
          <EmptyState>No conversations yet. Pick someone below to send your first message.</EmptyState>
        ) : (
          <ul className="thread-list" aria-label="Your conversations, most recent first">
            {threads.map((thread) => (
              <li key={thread.partnerId} className="card thread">
                <Link className="thread__link" to={`/messages/${thread.partnerId}`}>
                  <span className="thread__name">{thread.partnerUsername}</span>
                  <span className="thread__preview">{truncate(thread.lastBody, 80)}</span>
                </Link>
                <DateChip iso={thread.lastCreatedAt} icon="clock" withTime />
              </li>
            ))}
          </ul>
        )}
      </section>

      {newContacts.length > 0 && (
        <section className="messages-section" aria-labelledby="people-heading">
          <div className="section-header">
            <h2 id="people-heading" className="section-header__title">
              Start a conversation
            </h2>
          </div>
          <ul className="people-list" aria-label="People you can message">
            {newContacts.map((person) => (
              <li key={person.id} className="card person">
                <Link className="person__link" to={`/messages/${person.id}`}>
                  {person.username}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
