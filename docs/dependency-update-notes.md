# Dependency Update Notes

## Deferred Latest Versions

- `@types/node@25.x`: deferred because the local runtime and dependency plan target Node 24. The workspace now uses `@types/node@^24.12.3`.
- `pnpm@11.x`: deferred because the approved plan uses the mature pnpm 10 line for the main update. The workspace now declares `pnpm@10.33.4`.
