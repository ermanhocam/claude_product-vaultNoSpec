interface ImportMetaEnv {
  /** Base URL of the backend API, without the `/api` suffix. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
