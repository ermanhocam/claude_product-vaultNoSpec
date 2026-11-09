import type { InputHTMLAttributes, Ref } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  /** Marks the input invalid and links it to the element with `errorId`. */
  invalid?: boolean;
  errorId?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ id, label, hint, invalid = false, errorId, ...input }: TextFieldProps) {
  const describedBy = [hint && `${id}-hint`, invalid && errorId].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
