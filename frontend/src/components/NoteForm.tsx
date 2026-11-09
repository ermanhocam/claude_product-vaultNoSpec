import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { characterCount, NOTE_CONTENT_MAX_LENGTH, validateText } from '../lib/text';
import { CharacterCount } from './Feedback';

interface NoteFormProps {
  onAdd: (content: string) => Promise<void>;
}

export function NoteForm({ onAdd }: NoteFormProps) {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const problem = validateText(content, 'Note content', NOTE_CONTENT_MAX_LENGTH);
    if (problem) {
      setError(problem);
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAdd(content);
      setContent('');
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
      <label className="composer__label" htmlFor="new-note">
        New note
      </label>
      <textarea
        ref={textareaRef}
        id="new-note"
        className="input input--textarea"
        rows={3}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="What did you notice about this product?"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'new-note-count new-note-error' : 'new-note-count'}
      />
      {error && (
        <p id="new-note-error" className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <CharacterCount id="new-note-count" count={characterCount(content.trim())} max={NOTE_CONTENT_MAX_LENGTH} />
        <button className="button button--primary" type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add note'}
        </button>
      </div>
    </form>
  );
}
