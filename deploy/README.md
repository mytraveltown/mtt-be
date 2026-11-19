# Backend deployment

Pushing to `main` (or running the workflow by hand) runs [.github/workflows/deploy.yml](../.github/workflows/deploy.yml):

1. `npm ci` checks that `package-lock.json` is valid.
2. The workflow checks that `/var/www/backend/.env` exists on the server.
3. rsync copies the repo into `/var/www/backend`. These server-only paths are never uploaded or deleted: `.env`, `.git/`, `node_modules/`, `uploads/`, `logs/` and `backups/`.
4. Over SSH, the workflow runs `npm ci --omit=dev`, `pm2 reload all --update-env` and `pm2 save` in `/var/www/backend`.

## GitHub secrets

| Secret | Value |
| --- | --- |
| `VPS_HOST` | Server hostname or IP |
| `VPS_USER` | SSH user that can write to `/var/www/backend` and owns the PM2 process |
| `VPS_SSH_KEY` | Private key whose public key is in `~VPS_USER/.ssh/authorized_keys` |
| `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan -H <VPS_HOST>` |

## Things to know

- rsync runs with `--delete`, so any other file that exists only on the server inside `/var/www/backend` is removed on deploy. To keep one, add it to the excludes in the workflow.
- Migrations in `migrations/` are plain SQL files and are not run by the deploy. Back up the database, then apply new ones manually before pushing code that depends on them.
