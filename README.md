# SelfMade HRM

Modern HR portal for SelfMade Tech. **Phase 1**: employee and manager/HR portals, leave management, calendar, notifications, audit log, RBAC.

- **Backend** - ASP.NET Core 10 minimal APIs, EF Core 10, SQL Server, JWT auth (`/backend`)
- **Frontend** - React 19 + TypeScript + Vite (`/frontend`)

> The frontend is type-checked, unit-tested and production-built. The backend was written without access to the .NET SDK, so it has **not been compiled yet**. Your first `dotnet build` may show a few small errors - see "First run" below.

## Prerequisites

- Visual Studio 2026 (or 2022 with .NET 10 SDK) with the **ASP.NET and web development** workload
- .NET 10 SDK, Node.js 20+ (22 recommended), Git
- A SQL Server instance you can create a database on

## 1. Backend

1. Open `backend/SelfMade.Hrm.slnx` in Visual Studio.
2. Right-click **SelfMade.Hrm.Api** -> **Manage User Secrets** and paste (use your own values):

```json
{
  "ConnectionStrings": { "Default": "Server=YOUR_SERVER;Database=SelfMadeHrm;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true" },
  "Jwt": { "Key": "at-least-32-random-characters-long-secret-key" }
}
```

3. Create the first migration (Package Manager Console, default project = `SelfMade.Hrm.Api`, or a terminal in `backend/src/SelfMade.Hrm.Api`):

```bash
dotnet tool install --global dotnet-ef   # once
dotnet ef migrations add InitialCreate
```

4. Run the API (F5, profile `http`). It listens on http://localhost:5080. In Development it applies migrations and seeds demo data automatically when the database is empty.
5. Health check: http://localhost:5080/health/ready - API docs: http://localhost:5080/openapi/v1.json

Tests: `dotnet test backend/SelfMade.Hrm.slnx`

## 2. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api to :5080)
npm run typecheck
npm test
npm run build
```

## Demo accounts (Development only)

All use password `Password@123`: `admin@`, `hr@`, `manager@`, `shreyas@`, `anita@`, `vikram@`, `neha@` (all `@selfmade.tech`). Seeding is off in production (`Seed:Enabled=false`). Create real users from **Manage people** and change the demo passwords or disable them.

## Email (SMTP)

Set in user-secrets or environment variables: `Smtp:Host`, `Smtp:Port`, `Smtp:User`, `Smtp:Password`, `Smtp:From`. Without a host, emails stay in the outbox table and nothing is sent. The daily digest, birthday and anniversary jobs run at `Org:DigestHour` in `Org:TimeZoneId`.

## Production checklist

- Set `ConnectionStrings__Default`, `Jwt__Key`, `Cors__Origins`, `App__FrontendUrl` as environment variables (never commit secrets).
- Serve the built `frontend/dist` over HTTPS and route `/api` and `/uploads` to the API.
- Keep `Seed:Enabled=false`. Use `dotnet ef database update` for schema changes.

## Push to GitHub

Create an empty repository on GitHub first (no README), then from the project root:

```bash
git init
git branch -M main
git add .
git status                      # confirm no secrets, bin/, obj/ or node_modules/
git commit -m "Initial commit: SelfMade HRM phase 1"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

Later changes: `git add . && git commit -m "message" && git push`.

## Roadmap

Phase 2: attendance and timesheets. Phase 3-4: per the requirements document. Known Phase 1 gaps: recalculating leave when a holiday changes after approval, and effective-dated employee disable.
