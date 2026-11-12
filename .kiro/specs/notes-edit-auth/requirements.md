# Requirements Document

## Introduction

Today the Product Vault backend lets any caller edit a note: the `PUT /api/notes/:noteId` route has no authentication, and the frontend always renders the Edit control regardless of who is viewing. This feature restricts note editing to authenticated users and, as a deliberate scope expansion beyond the literal request, to the user who authored the note. Enforcement is anchored in the backend (the real gate), while the frontend hides the Edit control when the viewer cannot edit a note.

Delivering author-only editing requires persisting the author of each note. The notes table currently has no author column, so the feature adds an author reference, records the creating user on note creation, exposes the author identifier on the Note payload, and decides how to treat notes that predate the column (notes with no recorded author). The frontend currently exposes only a username for the logged-in user; a shared identifier that both sides can compare must be surfaced so the frontend can determine authorship. The exact backfill strategy for authorless notes and the exact shape of the shared identifier are design decisions deferred to the design phase.

## Glossary

- **Note_API**: The backend Express route layer handling note requests, specifically `PUT /api/notes/:noteId` in `backend/src/routes/notes.ts` and `POST /api/products/:productId/notes` in `backend/src/routes/products.ts`.
- **Note_Repository**: The data-access layer for notes (`NoteRepository` in `backend/src/db/repositories.ts`).
- **Note_Schema**: The SQLite `notes` table definition in `backend/src/db/database.ts`.
- **Auth_Middleware**: The `requireAuth` Express middleware (`createAuthMiddleware` in `backend/src/auth/middleware.ts`) that verifies the bearer token and attaches the authenticated user to `req.user`.
- **Authenticated_User**: A caller whose request carries a valid bearer token, represented server-side by `req.user` of type `AuthUser` (`{ id, username }`).
- **Note_Author**: The Authenticated_User who created a note, persisted as the note's author reference.
- **Author_Identifier**: A single value present on both the Note payload and the current-user identity that uniquely identifies a user, used to decide whether the current user is the Note_Author.
- **Authorless_Note**: A note stored before the author column existed, which therefore has no recorded Note_Author.
- **Product_Detail_Page**: The frontend page component `ProductDetailPage` in `frontend/src/pages/ProductDetailPage.tsx`.
- **Note_Item**: The frontend component `NoteItem` in `frontend/src/components/NoteItem.tsx` that renders a single note and its Edit control.
- **Current_User**: The logged-in user represented by the frontend auth context (`useAuth().user`), or `null` when nobody is logged in.

## Requirements

### Requirement 1: Authentication required to edit notes

**User Story:** As the system owner, I want note editing to require authentication, so that anonymous callers cannot modify notes.

#### Acceptance Criteria

1. WHEN a request is received at `PUT /api/notes/:noteId` without a valid bearer token, THE Note_API SHALL respond with HTTP status 401 and SHALL NOT modify any note.
2. WHEN a request is received at `PUT /api/notes/:noteId` without a valid bearer token, THE Note_API SHALL run Auth_Middleware before looking up the note so that the response does not reveal whether the note id exists.
3. WHEN an Authenticated_User sends a valid `PUT /api/notes/:noteId` request for a note that does not exist, THE Note_API SHALL respond with HTTP status 404.

### Requirement 2: Author-only note editing

**User Story:** As a note author, I want only myself to edit my notes, so that other users cannot alter my content.

#### Acceptance Criteria

1. WHEN an Authenticated_User sends a valid `PUT /api/notes/:noteId` request for an existing note whose Note_Author is that Authenticated_User, THE Note_API SHALL update the note content and respond with HTTP status 200 and the updated note.
2. IF an Authenticated_User sends a valid `PUT /api/notes/:noteId` request for an existing note whose Note_Author is a different user, THEN THE Note_API SHALL respond with HTTP status 403 and SHALL NOT modify the note.
3. IF an Authenticated_User sends a valid `PUT /api/notes/:noteId` request for an Authorless_Note, THEN THE Note_API SHALL apply the Authorless_Note authorization outcome defined in the design.

### Requirement 3: Record note author on creation

**User Story:** As the system owner, I want each note to record the user who created it, so that author-only editing can be enforced.

#### Acceptance Criteria

1. THE Note_Schema SHALL include an author reference column on the notes table that points to the users table.
2. WHEN an Authenticated_User sends a valid `POST /api/products/:productId/notes` request for an existing product, THE Note_API SHALL create the note with the Note_Author set to that Authenticated_User.
3. WHEN Note_Repository creates a note, THE Note_Repository SHALL persist the Note_Author identifier supplied for that note.
4. WHERE the Note_Schema is applied to a database that already contains notes without an author column, THE Note_Schema SHALL preserve the existing notes as Authorless_Notes using the migration approach defined in the design.

### Requirement 4: Author identifier on note payload and current user

**User Story:** As a frontend developer, I want the note payload to carry the author's identifier, so that the client can compare it against the current user.

#### Acceptance Criteria

1. THE Note_API SHALL include the Author_Identifier of the Note_Author on each note returned to the client.
2. WHERE a note is an Authorless_Note, THE Note_API SHALL represent the absent Note_Author on that note's payload using the representation defined in the design.
3. THE Current_User identity provided by the frontend auth context SHALL expose an Author_Identifier of the same kind returned on the note payload, so that the two can be compared directly.

### Requirement 5: Edit control visible only to the author

**User Story:** As a user viewing a product, I want to see the Edit control only on notes I can edit, so that the interface reflects what the backend allows.

#### Acceptance Criteria

1. WHEN the Product_Detail_Page renders a note AND the Current_User is `null`, THE Product_Detail_Page SHALL render the Note_Item without an edit handler so that the Edit control is hidden.
2. WHEN the Product_Detail_Page renders a note AND the Current_User's Author_Identifier does not match the note's Note_Author Author_Identifier, THE Product_Detail_Page SHALL render the Note_Item without an edit handler so that the Edit control is hidden.
3. WHEN the Product_Detail_Page renders a note AND the Current_User's Author_Identifier matches the note's Note_Author Author_Identifier, THE Product_Detail_Page SHALL render the Note_Item with an edit handler so that the Edit control is shown.
4. WHERE the Note_Item receives no edit handler, THE Note_Item SHALL hide the Edit control, consistent with how the Delete control is hidden when no delete handler is provided.
