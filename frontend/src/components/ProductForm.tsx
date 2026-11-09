import { type FormEvent, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { characterCount, PRODUCT_NAME_MAX_LENGTH, validateText } from '../lib/text';
import { CharacterCount } from './Feedback';

interface ProductFormProps {
  onCreate: (name: string) => Promise<void>;
}

// The counter only appears once a name gets long enough for the limit to matter.
const SHOW_COUNT_FROM = Math.floor(PRODUCT_NAME_MAX_LENGTH * 0.8);

export function ProductForm({ onCreate }: ProductFormProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const count = characterCount(name.trim());

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateText(name, 'Product name', PRODUCT_NAME_MAX_LENGTH);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name);
      setName('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }

  const describedBy = [count >= SHOW_COUNT_FROM && 'product-name-count', error && 'product-name-error']
    .filter(Boolean)
    .join(' ');

  return (
    <form className="card toolbar" onSubmit={handleSubmit} noValidate>
      <label className="visually-hidden" htmlFor="product-name">
        Product name
      </label>
      <div className="toolbar__row">
        <input
          ref={inputRef}
          id="product-name"
          className="input"
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Add a product, e.g. Moka pot 6-cup"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        <button className="button button--primary" type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add product'}
        </button>
      </div>
      {count >= SHOW_COUNT_FROM && (
        <CharacterCount id="product-name-count" count={count} max={PRODUCT_NAME_MAX_LENGTH} />
      )}
      {error && (
        <p id="product-name-error" className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
