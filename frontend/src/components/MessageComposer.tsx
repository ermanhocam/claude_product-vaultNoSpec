import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { characterCount, MESSAGE_BODY_MAX_LENGTH, validateText } from '../lib/text';
import { CharacterCount } from './Feedback';

interface MessageComposerProps {
  /** Resolves once the message has been sent, so the composer clears on success. */
  onSend: (body: string) => Promise<void>;
  recipient: string;
}

/** The input row for sending a direct message. Ctrl/Cmd+Enter submits, like the note composer. */
export function MessageComposer({ onSend, recipient }: MessageComposerProps) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const problem = validateText(body, 'Message', MESSAGE_BODY_MAX_LENGTH);
    if (problem) {
      setError(problem);
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSend(body);
      setBody('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} className="card composer" onSubmit={handleSubmit} noValidate>
      <label className="composer__label" htmlFor="new-message">
        Message {recipient}
      </label>
      <textarea
        ref={textareaRef}
        id="new-message"
        className="input input--textarea"
        rows={3}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={`Write a message to ${recipient}…`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'new-message-count new-message-error' : 'new-message-count'}
      />
      {error && (
        <p id="new-message-error" className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <CharacterCount id="new-message-count" count={characterCount(body.trim())} max={MESSAGE_BODY_MAX_LENGTH} />
        <button className="button button--primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
