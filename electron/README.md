# Flora Electron shell

Electron is an optional desktop presentation shell for Flora Leaf. It loads the
same React build as browser access and calls the Python/FastAPI service configured
by `FLORA_API_BASE_URL` (default `http://127.0.0.1:6893`). Clinical data remains in
PostgreSQL; the installer and desktop process do not create or copy a database.

## Development

```powershell
docker compose -f compose.dev.yaml up -d postgres flora-leaf-api
npm run desktop:start
```

## Package for Windows

```powershell
npm run desktop:package:win
```

The package contains the Electron shell, static frontend bundle, application
icons, and PDF renderer. The FastAPI/PostgreSQL services are deployed separately
with Docker Compose.
