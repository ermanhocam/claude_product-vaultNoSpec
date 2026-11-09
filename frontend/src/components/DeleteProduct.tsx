import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Product } from '../types';

interface DeleteProductProps {
  product: Product;
  /** Called once the product is gone on the server; the caller then takes it out of view. */
  onDeleted: (product: Product) => void;
  /** Content of the button that opens the confirmation. */
  children: ReactNode;
  /** Accessible name of that button, for when its content doesn't name the product. */
  buttonLabel?: string;
}

export function DeleteProduct({ product, onDeleted, children, buttonLabel }: DeleteProductProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = useId();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The Delete button isn't rendered while the confirmation is open,
  // so remember to refocus it once it is back after a cancel.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (returnFocus.current) {
      deleteButtonRef.current?.focus();
      returnFocus.current = false;
    }
  }, [confirming]);

  function cancel() {
    returnFocus.current = true;
    setError(null);
    setConfirming(false);
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteProduct(product.id);
    } catch (err) {
      // A 404 means it's already gone on the server: the outcome the user wanted.
      if (!(err instanceof ApiError && err.status === 404)) {
        setError(errorMessage(err));
        setBusy(false);
        return;
      }
    }
    onDeleted(product);
  }

  if (!confirming) {
    return (
      <button
        ref={deleteButtonRef}
        className="text-button text-button--danger"
        type="button"
        aria-label={buttonLabel}
        onClick={() => setConfirming(true)}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      className="confirm"
      role="alertdialog"
      aria-labelledby={`${id}-confirm`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) cancel();
      }}
    >
      <p id={`${id}-confirm`} className="confirm__question">
        Delete “{product.name}” and all of its notes? This can’t be undone.
      </p>
      <div className="button-row">
        <button ref={cancelRef} className="button button--secondary" type="button" onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <button className="button button--danger" type="button" onClick={confirmDelete} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete product'}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
