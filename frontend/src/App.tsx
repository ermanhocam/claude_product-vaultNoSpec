import { Link, Route, Routes } from 'react-router';
import { AuthProvider, useAuth, useAuthLinkState } from './auth/AuthContext';
import { ConversationPage } from './pages/ConversationPage';
import { LoginPage } from './pages/LoginPage';
import { MessagesPage } from './pages/MessagesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProductListPage } from './pages/ProductListPage';
import { RegisterPage } from './pages/RegisterPage';

function AccountNav() {
  const { user, logout } = useAuth();
  const linkState = useAuthLinkState();

  return (
    <nav className="account" aria-label="Account">
      {user ? (
        <>
          <Link className="account__link" to="/messages">
            Messages
          </Link>
          <span className="account__user">
            <span className="account__prefix">Signed in as </span>
            <strong>{user.username}</strong>
          </span>
          <button className="account__action" type="button" onClick={logout}>
            Log out
          </button>
        </>
      ) : (
        <>
          <Link className="account__link" to="/login" state={linkState}>
            Log in
          </Link>
          <Link className="account__action" to="/register" state={linkState}>
            Register
          </Link>
        </>
      )}
    </nav>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="app">
        <header className="topbar">
          <div className="container container--wide topbar__inner">
            <Link className="brand" to="/" aria-label="Product Vault home">
              Product<span className="brand__accent">Vault</span>
            </Link>
            <AccountNav />
          </div>
        </header>

        <main className="container page">
          <Routes>
            <Route path="/" element={<ProductListPage />} />
            <Route path="/products/:productId" element={<ProductDetailPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:userId" element={<ConversationPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}
