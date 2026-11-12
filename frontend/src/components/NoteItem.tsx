import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { formatDateTime } from '../lib/format';
import { characterCount, NOTE_CONTENT_MAX_LENGTH, validateText } from '../lib/text';
import type { Note } from '../types';
import { DateChip } from './DateChip';
import { CharacterCount } from './Feedback';

interface NoteItemProps {
  note: Note;
  /** Leave out to hide the Edit action (editing needs to be the author). */
  onSave?: (content: string) => Promise<void>;
  /** Leave out to hide the Delete action (deleting needs a login). */
  onDelete?: () => Promise<void>;
}

type Mode = 'view' | 'edit' | 'confirm-delete';

export function NoteItem({ note, onSave, onDelete }: NoteItemProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(note.content);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = useId();
  const editRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  // The button that opened the editor/confirmation isn't rendered while it is open,
  // so remember which one to refocus and resolve the ref once view mode is back.
  const returnFocusTo = useRef<'edit' | 'delete' | null>(null);

  useEffect(() => {
    if (mode === 'edit') {
      const textarea = editRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    } else if (mode === 'confirm-delete') {
      cancelDeleteRef.current?.focus();
    } else if (returnFocusTo.current) {
      (returnFocusTo.current === 'edit' ? editButtonRef : deleteButtonRef).current?.focus();
      returnFocusTo.current = null;
    }
  }, [mode]);

  const timestamp = formatDateTime(note.createdAt);

  function startEditing() {
    setDraft(note.content);
    setError(null);
    setMode('edit');
  }

  function backToView(focusTarget: 'edit' | 'delete') {
    returnFocusTo.current = focusTarget;
    setError(null);
    setMode('view');
  }

  async function save() {
    if (!onSave) return;
    const problem = validateText(draft, 'Note content', NOTE_CONTENT_MAX_LENGTH);
    if (problem) {
      setError(problem);
      editRef.current?.focus();
      return;
    }
    if (draft.trim() === note.content) {
      backToView('edit');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      backToView('edit');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(); // on success the parent removes this item
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      backToView('edit');
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  }

  return (
    <li className="card note-card">
      {mode === 'edit' ? (
        <div className="note-card__editor">
          <label className="visually-hidden" htmlFor={`${id}-edit`}>
            Edit note from {timestamp}
          </label>
          <textarea
            ref={editRef}
            id={`${id}-edit`}
            className="input input--textarea"
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleEditKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-count ${id}-error` : `${id}-count`}
          />
          <div className="form-footer">
            <CharacterCount id={`${id}-count`} count={characterCount(draft.trim())} max={NOTE_CONTENT_MAX_LENGTH} />
            <div className="button-row">
              <button className="button button--secondary" type="button" onClick={() => backToView('edit')} disabled={busy}>
                Cancel
              </button>
              <button className="button button--primary" type="button" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="note-card__content">{note.content}</p>
      )}

      {mode === 'confirm-delete' && onDelete && (
        <div
          className="confirm"
          role="alertdialog"
          aria-labelledby={`${id}-confirm`}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) backToView('delete');
          }}
        >
          <p id={`${id}-confirm`} className="confirm__question">
            Delete this note? This can’t be undone.
          </p>
          <div className="button-row">
            <button
              ref={cancelDeleteRef}
              className="button button--secondary"
              type="button"
              onClick={() => backToView('delete')}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="button button--danger" type="button" onClick={confirmDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete note'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="note-card__footer">
        <div className="note-card__actions">
          {mode === 'view' && (
            <>
              {onSave && (
                <button ref={editButtonRef} className="text-button" type="button" onClick={startEditing}>
                  Edit<span className="visually-hidden"> note from {timestamp}</span>
                </button>
              )}
              {onDelete && (
                <button
                  ref={deleteButtonRef}
                  className="text-button text-button--danger"
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('confirm-delete');
                  }}
                >
                  Delete<span className="visually-hidden"> note from {timestamp}</span>
                </button>
              )}
            </>
          )}
        </div>
        <DateChip iso={note.createdAt} icon="clock" withTime />
      </div>
    </li>
  );
}
