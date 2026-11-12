import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { ProductSearchCriteria } from '../types';

interface ProductSearchProps {
  /** The committed criteria currently driving the results. An empty `query` shows everything. */
  criteria: ProductSearchCriteria;
  /** Whether the visitor is logged in; the advanced filters only show when they are. */
  canUseAdvanced: boolean;
  /** Called with the new criteria whenever the user commits a search (debounced name typing or submit). */
  onSearch: (criteria: ProductSearchCriteria) => void;
}

// Keep live name-search typing responsive without firing a request on every keystroke.
const DEBOUNCE_MS = 250;

const EMPTY: ProductSearchCriteria = { query: '', from: '', to: '', noteText: '', author: '' };

/** True when every filter is blank. */
function isEmpty(criteria: ProductSearchCriteria): boolean {
  return !criteria.query && !criteria.from && !criteria.to && !criteria.noteText && !criteria.author;
}

/** Trims text fields and drops empty ones so the committed criteria match what the API receives. */
function clean(criteria: ProductSearchCriteria): ProductSearchCriteria {
  return {
    query: criteria.query.trim(),
    from: criteria.from || undefined,
    to: criteria.to || undefined,
    noteText: criteria.noteText?.trim() || undefined,
    author: criteria.author?.trim() || undefined,
  };
}

/** True when only the public name filter is set (so the advanced panel need not stay open). */
function sameCommitted(a: ProductSearchCriteria, b: ProductSearchCriteria): boolean {
  return (
    a.query === b.query &&
    (a.from ?? '') === (b.from ?? '') &&
    (a.to ?? '') === (b.to ?? '') &&
    (a.noteText ?? '') === (b.noteText ?? '') &&
    (a.author ?? '') === (b.author ?? '')
  );
}

export function ProductSearch({ criteria, canUseAdvanced, onSearch }: ProductSearchProps) {
  const [form, setForm] = useState<ProductSearchCriteria>({ ...EMPTY, ...criteria });
  const inputRef = useRef<HTMLInputElement>(null);
  // Only advanced fields are present if an advanced filter is active (e.g. from a shared state).
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(criteria.from || criteria.to || criteria.noteText || criteria.author),
  );

  // Keep the fields in sync when the criteria change from outside (e.g. "Clear" or a new product).
  useEffect(() => {
    setForm({ ...EMPTY, ...criteria });
  }, [criteria]);

  // Debounce the name field for live search; other filters commit on submit only. Advanced
  // filters stay out of the debounce so typing a note/author doesn't fire a request mid-word.
  useEffect(() => {
    const next = clean(form);
    const committed = clean({ ...EMPTY, ...criteria });
    // Only the name differs → live-commit it (preserving any committed advanced filters).
    if (
      next.query !== committed.query &&
      (next.from ?? '') === (committed.from ?? '') &&
      (next.to ?? '') === (committed.to ?? '') &&
      (next.noteText ?? '') === (committed.noteText ?? '') &&
      (next.author ?? '') === (committed.author ?? '')
    ) {
      const handle = setTimeout(() => onSearch(next), DEBOUNCE_MS);
      return () => clearTimeout(handle);
    }
  }, [form, criteria, onSearch]);

  function set<K extends keyof ProductSearchCriteria>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent) {
    // Submitting commits every field immediately, bypassing the name debounce.
    event.preventDefault();
    onSearch(clean(form));
  }

  function handleClear() {
    setForm({ ...EMPTY });
    onSearch({ query: '' });
    inputRef.current?.focus();
  }

  const dirty = !isEmpty(form) || !sameCommitted(clean(form), clean({ ...EMPTY, ...criteria }));

  return (
    <form className="card toolbar search-form" onSubmit={handleSubmit} role="search" noValidate>
      <div className="toolbar__row">
        <label className="visually-hidden" htmlFor="product-search">
          Search products by name
        </label>
        <input
          ref={inputRef}
          id="product-search"
          className="input"
          type="search"
          value={form.query}
          onChange={(event) => set('query', event.target.value)}
          placeholder="Search products, e.g. moka pot"
          autoComplete="off"
          enterKeyHint="search"
        />
        {dirty && (
          <button className="button button--secondary" type="button" onClick={handleClear}>
            Clear
          </button>
        )}
        <button className="button button--primary" type="submit">
          Search
        </button>
      </div>

      {canUseAdvanced && (
        <div className="search-form__advanced">
          <button
            type="button"
            className="text-button"
            aria-expanded={showAdvanced}
            aria-controls="advanced-filters"
            onClick={() => setShowAdvanced((open) => !open)}
          >
            {showAdvanced ? 'Hide advanced filters' : 'Advanced filters'}
          </button>

          {showAdvanced && (
            <fieldset id="advanced-filters" className="search-form__fields">
              <legend className="visually-hidden">Advanced filters</legend>

              <div className="field">
                <label htmlFor="search-from">Created from</label>
                <input
                  id="search-from"
                  className="input"
                  type="date"
                  value={form.from ?? ''}
                  max={form.to || undefined}
                  onChange={(event) => set('from', event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="search-to">Created to</label>
                <input
                  id="search-to"
                  className="input"
                  type="date"
                  value={form.to ?? ''}
                  min={form.from || undefined}
                  onChange={(event) => set('to', event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="search-note-text">Note contains</label>
                <input
                  id="search-note-text"
                  className="input"
                  type="text"
                  value={form.noteText ?? ''}
                  onChange={(event) => set('noteText', event.target.value)}
                  placeholder="Text inside a note"
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor="search-author">Note by user</label>
                <input
                  id="search-author"
                  className="input"
                  type="text"
                  value={form.author ?? ''}
                  onChange={(event) => set('author', event.target.value)}
                  placeholder="Username"
                  autoComplete="off"
                />
              </div>
            </fieldset>
          )}
        </div>
      )}
    </form>
  );
}
