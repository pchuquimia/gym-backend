# Database operations

## Quality checks

Run the read-only audit before every database migration:

```powershell
npm run db:quality:audit
```

Apply the guarded repair only after reviewing its summary:

```powershell
npm run db:quality:apply
```

The apply command writes a reference-only backup under
`../artifacts/database-backups/` before changing data. Restore a repair with:

```powershell
node scripts/repairDatabaseQuality.js --rollback=<absolute-backup-path>
```

The repair preserves missing parent identifiers in historical fields, installs
indexes, initializes concurrency versions, and enables MongoDB validators in
`moderate` + `warn` mode. Review Atlas validation warnings before promoting
them to `error`.

## Required Atlas production controls

- Use a dedicated application user with read/write access only to the `gym`
  database. Do not use an Atlas project owner credential in `MONGO_URI`.
- Restrict the Atlas network access list to deployment egress addresses.
- Keep the `mongodb+srv` TLS connection and never enable insecure certificate
  options.
- Configure `BACKEND_REGION` and `MONGO_REGION` and keep both workloads in the
  same region whenever possible.
- Enable Cloud Backup and Continuous Cloud Backup with at least a seven-day
  point-in-time recovery window.
- Retain daily snapshots for 7 days, weekly snapshots for 4 weeks, and monthly
  snapshots for 12 months, unless business requirements demand more.
- Perform and document a restore drill at least quarterly. Record RPO, RTO,
  restore duration, restored snapshot, and validation result.
- Alert on connection saturation, replication lag, query latency, storage
  growth, and failed backups.

## Deployment sequence

1. Run `npm test` and `npm audit --omit=dev`.
2. Run `npm run db:quality:audit` and require a zero result.
3. Deploy index and schema changes before traffic is shifted.
4. Restart the API and verify `/api/health/architecture`.
5. Monitor MongoDB validation warnings and slow queries after deployment.
