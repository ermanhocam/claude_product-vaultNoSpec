import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DateChip } from '../components/DateChip';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { MessageComposer } from '../components/MessageComposer';
import { useResource } from '../lib/useResource';

/** How often the open conversation refetches, so messages from the other person appear. */
const POLL_INTERVAL_MS = 4000;

export function ConversationPage() {
  const { userId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);

  // Logged-out users can't read a conversation; send them to log in and return here.
  useEffect(() => {
    if (!user) navigate('/login', { replace: true, state: { from: `/messages/${userId}` } });
  }, [user, navigate, userId]);

  const { state, update, reload } = useResource(() => api.getConversation(userId), [userId, user?.id]);

  const partnerName = state.status === 'success' ? state.data.partner.username : null;
  useEffect(() => {
    document.title = partnerName ? `Chat with ${partnerName} | Product Vault` : 'Messages | Product Vault';
  }, [partnerName]);

  // Poll while the conversation is open so the other person's replies show up without a manual
  // refresh. `reload` only re-runs the loader; the cleanup clears the timer on unmount/route change.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [user, reload]);

  const messageCount = state.status === 'success' ? state.data.messages.length : 0;
  // Keep the newest message in view as the transcript grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messageCount]);

  if (!user) return null;

  if (state.status === 'loading') return <Loading>Loading conversation…</Loading>;

  if (state.status === 'error') {
    const notFound = state.error.status === 404;
    return (
      <>
        <BackToMessages />
        <ErrorNotice
          title={notFound ? 'This person doesn’t exist.' : 'This conversation couldn’t be loaded.'}
          detail={notFound ? 'The user may have been removed, or the link may be wrong.' : state.error.message}
          action={
            notFound ? (
              <Link className="button button--secondary" to="/messages">
                Back to messages
              </Link>
            ) : (
              <button className="button button--secondary" type="button" onClick={reload}>
                Try again
              </button>
            )
          }
        />
      </>
    );
  }

  const { partner, messages } = state.data;

  async function handleSend(body: string) {
    const message = await api.sendMessage(partner.id, body);
    // Append locally so the sent message shows immediately; the poll will reconcile the rest.
    update((current) => ({ ...current, messages: [...current.messages, message] }));
  }

  return (
    <section aria-labelledby="conversation-heading">
      <BackToMessages />
      <div className="page-header">
        <h1 id="conversation-heading" className="page-title">
          {partner.username}
        </h1>
      </div>

      {messages.length === 0 ? (
        <EmptyState>No messages yet. Say hello to {partner.username}.</EmptyState>
      ) : (
        <ol className="message-list" aria-label={`Conversation with ${partner.username}`}>
          {messages.map((message) => {
            const mine = message.senderId === user.id;
            return (
              <li key={message.id} className={mine ? 'message message--mine' : 'message message--theirs'}>
                <p className="message__body">{message.body}</p>
                <DateChip iso={message.createdAt} icon="clock" withTime />
              </li>
            );
          })}
          <div ref={endRef} />
        </ol>
      )}

      <MessageComposer onSend={handleSend} recipient={partner.username} />
    </section>
  );
}

function BackToMessages() {
  return (
    <Link className="back-link" to="/messages">
      ← All messages
    </Link>
  );
}
