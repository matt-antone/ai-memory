# Release Process

## Versioning

- Use semver tags such as `v0.1.0`.
- Record user-visible changes in `CHANGELOG.md` before tagging.

## Pre-release checklist

1. Run `npm test`.
2. Run `npm run test:integration` when the Supabase integration environment variables are available.
3. Run `npm run smoke:mcp` against the staging edge function.
4. Confirm `/healthz` and `/readyz` return success in staging.
5. Verify staging logs include request IDs, caller IDs, and stable error categories.

## Release steps

1. Commit the release changes.
2. Tag the commit with the release version.
3. Deploy the SQL migrations to staging, then production.
4. Deploy the edge function to staging, run smoke tests, then promote to production.
5. Update `CHANGELOG.md` for the next unreleased cycle.

## Rollback

- Revert the edge function to the previous version if runtime behavior regresses.
- Reapply the previous tag or commit in the MCP host if client config needs to roll back.
- Keep database rollbacks additive where possible; prefer forward fixes for schema issues after a migration is applied.
