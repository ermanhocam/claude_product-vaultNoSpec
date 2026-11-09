import type { ReactNode } from 'react';

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  );
}

interface ErrorNoticeProps {
  title: string;
  detail?: string;
  action?: ReactNode;
}

export function ErrorNotice({ title, detail, action }: ErrorNoticeProps) {
  return (
    <div className="card notice" role="alert">
      <p className="notice__title">{title}</p>
      {detail && <p className="notice__detail">{detail}</p>}
      {action && <div className="notice__action">{action}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="card empty">{children}</p>;
}

interface CharacterCountProps {
  id: string;
  count: number;
  max: number;
}

export function CharacterCount({ id, count, max }: CharacterCountProps) {
  const over = count > max;
  return (
    <p id={id} className={over ? 'char-count char-count--over' : 'char-count'}>
      {count.toLocaleString()} / {max.toLocaleString()} characters
    </p>
  );
}
