# Tools Page

A simple, dark-mode page that lists my web apps grouped by category (Finance, CV, Tech, …). Anyone can view it; only I can log in to add or delete links.

- No dependencies: just Node.js 22.9+
- Links are saved to `data/tools.json`

## Run locally

```bash
cp .env.example .env   # then set ADMIN_PASSWORD and SESSION_SECRET
npm start
```

Open http://localhost:3000. To log in, go to http://localhost:3000/login.

## Settings (environment variables)

| Variable         | Required    | What it does                                                        |
| ---------------- | ----------- | ------------------------------------------------------------------- |
| `ADMIN_PASSWORD` | yes         | The password you log in with                                        |
| `SESSION_SECRET` | recommended | Long random string; without it you're logged out on every restart   |
| `DATA_DIR`       | on hosts    | Folder where `tools.json` is stored (point it at a persistent disk) |
| `SITE_TITLE`     | no          | Page heading (default `Tools`)                                      |
| `PORT`           | no          | Set automatically by most hosts                                     |

## Deploy

Any host that runs a Node server works. The start command is `npm start`.

**The data file must live on persistent storage**, or your tools disappear when the app redeploys:

- **Railway**: add a Volume mounted at `/data`, then set `DATA_DIR=/data`
- **Render**: add a Disk (paid plan) mounted at `/var/data`, then set `DATA_DIR=/var/data`
- **Fly.io**: create a volume, mount it at `/data`, then set `DATA_DIR=/data`
- **A VPS**: works as-is (use pm2 or systemd to keep it running)

Serverless hosts like Vercel and Netlify **won't** work because they can't save files.

Set `ADMIN_PASSWORD` and `SESSION_SECRET` in the host's environment settings. Never commit `.env`.
