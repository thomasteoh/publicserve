# Contributing to PublicServe

Thank you for your interest in contributing. This document covers how to set up a development environment, the conventions used in this codebase, and what to expect when submitting a pull request.

---

## Development Setup

### Prerequisites

- Node.js LTS (22.x recommended)
- An Azure subscription (for Table Storage and Key Vault)
- An SMTP server or service for testing email sign-in

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd publicserve
npm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
AUTH_SECRET=any-random-string-for-local-dev
AUTH_URL=http://localhost:3000
AZURE_TABLES_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...
AZURE_KEYVAULT_URI=https://your-vault.vault.azure.net/
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@example.com
```

All variables are required at runtime. The app will throw on startup if any are missing.

### 3. Run the development server

```bash
npm run dev
```

The app is available at `http://localhost:3000`. Sign in with any email address. The first user is automatically bootstrapped as platform administrator.

---

## Testing

### Unit Tests

Unit tests use Vitest with `jsdom` for browser simulation and `@vitest-environment node` for API route tests. Run them with:

```bash
npm test
```

All tests must pass before a PR can be merged. The CI workflow also runs `tsc --noEmit` — ensure types are clean.

**Test structure conventions:**

- Tests live under `tests/` mirroring the `src/` structure
- API route tests use `/** @vitest-environment node */` at the top
- Mock at the module boundary using `vi.mock()` with hoisted mock functions
- Use `await import(...)` inside each test to get a fresh module reference after mocks are set up
- `beforeEach(() => vi.clearAllMocks())` in every describe block — never share state between tests

**Writing tests for new lib modules** (follow `tests/lib/identity/groups.test.ts` as a template):

```typescript
vi.mock("@/lib/auth/tables", () => ({
  tableGet: vi.fn(),
  tableUpsert: vi.fn(),
  tableDelete: vi.fn(),
}))

import { tableGet } from "@/lib/auth/tables"

describe("myFunction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does the thing", async () => {
    vi.mocked(tableGet).mockResolvedValue({ ... })
    const { myFunction } = await import("@/lib/my-module")
    const result = await myFunction("arg")
    expect(result).toEqual(...)
  })
})
```

**Writing tests for new API routes** (follow `tests/app/api/admin/logs.test.ts`):

```typescript
/**
 * @vitest-environment node
 */
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: mockAuth }))
// ... more mocks

describe("GET /api/your/route", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import("@/app/api/your/route")
    const res = await GET(new Request("http://localhost/api/your/route"))
    expect(res.status).toBe(401)
  })
})
```

### Type Checking

```bash
npx tsc --noEmit
```

No type errors are acceptable. Avoid `any` — use proper type assertions or generics.

### End-to-End Tests

```bash
npm run test:e2e
```

E2E tests run against a live app with real Azure infrastructure. They are not expected to be run locally unless you have a full environment configured. They run automatically on push to `main`.

---

## Code Conventions

### Next.js App Router

- Server components are the default. Only add `"use client"` where interactivity is required.
- Route handler params in Next.js 15 are `Promise`s — always `await params` before destructuring:
  ```typescript
  export async function GET(
    _req: Request,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params
  ```
- Do not use `getServerSideProps` or the Pages Router.

### Authentication and Authorisation

- Always use `const session = await auth()` to get the session in route handlers.
- Always call `resolvePermissions(session.user.id, orgId)` before acting on org-scoped data.
- Prefer explicit permission checks (`!perms.canRead`) over trusting caller input.

### Azure Tables

Use the helpers in `src/lib/auth/tables.ts` (`tableGet`, `tableUpsert`, `tableDelete`, `tableList`). Do not call the Azure SDK directly from route handlers or lib modules.

### Audit Logging

Log every security-relevant event using `writeLog()` from `src/lib/logging.ts`. Choose the appropriate category:

| Category | When to use |
|---|---|
| `auth` | Sign-in, sign-up, API key generation/rotation/revocation |
| `crawl` | Crawl start, completion, and errors |
| `serve` | Document serve events |
| `permission_denied` | Any 403 or auth failure |
| `storage_error` | Key Vault or storage backend failures |

`writeLog` is fire-and-forget — do not await it. A failure to write a log should never fail a request.

### Error Handling

- Return structured JSON errors: `NextResponse.json({ error: "..." }, { status: N })`
- Do not expose internal error messages to the client. Log them server-side.
- Only validate at system boundaries (request bodies, external API responses). Trust internal module contracts.

### Key Vault Credentials

Never store storage credentials anywhere except Azure Key Vault. The credential ref pattern is `storage-cred-{locationId}`. Fetch at the point of use with `getSecret<CredentialType>(credentialRef)`.

---

## Pull Request Process

1. **Branch** from `main`. Use a descriptive branch name: `feat/`, `fix/`, `docs/`, `refactor/`.

2. **Write tests first.** The codebase follows TDD — write a failing test before implementing. All new behaviour must be covered by unit tests.

3. **Keep changes focused.** One logical change per PR. Do not bundle unrelated fixes, refactors, or dependency upgrades.

4. **Ensure CI passes.** The PR workflow runs unit tests and type checking. Both must pass. Do not merge if either is red.

5. **Fill in the PR description** with:
   - What problem this solves
   - How it was tested
   - Any deployment considerations (new env vars, Azure resources, Key Vault secrets)

6. **Do not force-push to `main`.** Shared history must remain intact.

---

## Adding a New Storage Backend

Storage backends implement the `StorageBackend` interface in `src/lib/storage/types.ts`:

```typescript
interface StorageBackend {
  list(rootPath: string): AsyncIterable<StorageEntry>
  readStream(path: string): Promise<NodeJS.ReadableStream>
  getSignedUrl(path: string, expiresInSecs: number): Promise<string | null>
}
```

Steps to add a backend:

1. Add a new credential type to the `StorageCredential` union in `src/lib/storage/types.ts`
2. Add a new `StorageLocationType` value
3. Implement the backend in `src/lib/storage/your-backend.ts`
4. Register it in the factory switch in `src/lib/storage/factory.ts`
5. Add unit tests under `tests/lib/storage/your-backend.test.ts`
6. Document the credential JSON format in `README.md` under **Adding Storage Credentials to Key Vault**

If `getSignedUrl` is not supported by the backend, return `null` — the serve route will fall back to server-side proxying.

---

## Versioning and Releases

This project uses [Semantic Versioning](https://semver.org).

- `MAJOR` — breaking changes to the API or data model
- `MINOR` — new features, backwards-compatible
- `PATCH` — bug fixes

Releases are created by publishing a GitHub Release with a semver tag. Tags containing `rc` deploy to non-production; all other tags deploy to production. See the [Deployment section in README.md](README.md#deployment) for details.
