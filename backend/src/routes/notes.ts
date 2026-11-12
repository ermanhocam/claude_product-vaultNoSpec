import { type Request, type RequestHandler, Router } from 'express';
import type { Note, NoteRepository } from '../db/repositories.js';
import { forbidden, notFound } from '../errors.js';
import { parseId, parseNoteContent } from '../validation.js';

export function createNotesRouter(notes: NoteRepository, requireAuth: RequestHandler): Router {
  const router = Router();

  const requireNote = (rawId: string | undefined): Note => {
    const id = parseId(rawId);
    const note = id === undefined ? undefined : notes.findById(id);
    if (!note) throw notFound('Note not found');
    return note;
  };

  // Editing needs a login and may only be done by the note's author. Authentication runs before
  // the note lookup, so anonymous callers get 401 without learning which note ids exist.
  router.put('/:noteId', requireAuth, (req: Request<{ noteId: string }>, res) => {
    const note = requireNote(req.params.noteId);
    // A single comparison also refuses authorless notes: `note.author` is null, never a user id.
    if (note.author !== req.user!.id) throw forbidden('You can only edit your own notes');
    res.json(notes.update(note.id, parseNoteContent(req.body)));
  });

  // Deleting needs a login. Authentication runs before the note lookup, so anonymous
  // callers get 401 without learning which note ids exist.
  router.delete('/:noteId', requireAuth, (req: Request<{ noteId: string }>, res) => {
    const { id } = requireNote(req.params.noteId);
    notes.delete(id);
    res.json({ id, deleted: true });
  });

  return router;
}
