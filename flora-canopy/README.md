# Flora Canopy

One per hospital. Central database for every Leaf (Ward, ICU, ER, OR), the sync
API Leaves push to, the read-only Canopy viewer, and **Haber**, the device
registry that gateways check in to.

```bash
docker compose up -d --build      # viewer http://localhost:7200, Haber http://localhost:7204
```

| Service | Port | Notes |
| --- | ---: | --- |
| canopy-web | 7200 | React viewer, `VITE_FLORA_SURFACE=canopy` |
| canopy-api | 7201 | `FLORA_API_MODE=canopy`, read-only `flora_view` role |
| canopy-db | 7202 | Own Postgres, not shared with any Leaf |
| sync-api | 7203 | `FLORA_API_MODE=sync`; Leaves push case snapshots here |
| haber | 7204 | Verifies Root's signed bundle; serves Device Type / Image / Device License to gateways |

API and web build from the shared source in `../services/flora-api` and `../frontend`.
Every Leaf and the sync API must share `FLORA_SYNC_SHARED_SECRET`.

Haber endpoints: `POST /api/haber/v1/gateways/{id}/checkin` (Bearer `HABER_GATEWAY_TOKEN`),
`GET /api/haber/v1/overview`, `POST /api/haber/v1/root/sync`.
