import { Link } from 'react-router';
import { ErrorNotice } from '../components/Feedback';

export function NotFoundPage() {
  return (
    <ErrorNotice
      title="This page doesn’t exist."
      detail="Check the address, or head back to your products."
      action={
        <Link className="button button--secondary" to="/">
          Go to all products
        </Link>
      }
    />
  );
}
