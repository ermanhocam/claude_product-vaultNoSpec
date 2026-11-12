import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { note } from '../test/utils';
import { NoteItem } from './NoteItem';

const editButton = () => screen.queryByRole('button', { name: /^Edit/ });
const deleteButton = () => screen.queryByRole('button', { name: /^Delete/ });

describe('NoteItem Edit visibility (Requirement 5.4)', () => {
  it('shows the Edit control when onSave is provided', () => {
    render(<NoteItem note={note()} onSave={vi.fn()} />);

    expect(editButton()).toBeInTheDocument();
  });

  it('hides the Edit control when onSave is omitted, mirroring the optional Delete action', () => {
    render(<NoteItem note={note()} />);

    expect(editButton()).not.toBeInTheDocument();
    // Delete is likewise hidden when its handler is absent.
    expect(deleteButton()).not.toBeInTheDocument();
  });

  it('shows Edit independently of Delete (onSave without onDelete)', () => {
    render(<NoteItem note={note()} onSave={vi.fn()} />);

    expect(editButton()).toBeInTheDocument();
    expect(deleteButton()).not.toBeInTheDocument();
  });

  it('shows Delete without Edit when only onDelete is provided', () => {
    render(<NoteItem note={note()} onDelete={vi.fn()} />);

    expect(editButton()).not.toBeInTheDocument();
    expect(deleteButton()).toBeInTheDocument();
  });
});
