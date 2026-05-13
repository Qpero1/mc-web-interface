# mc-panel

A full-stack web panel for managing one or more Minecraft servers over your
private Tailscale network. Stream the live console, browse and edit files
over SFTP, manage mods and worlds, take backups on a schedule, and edit
`server.properties` — all from one place.

> _Screenshot placeholder — drop a screenshot here once you've deployed the panel._

## Why this exists

Most existing panels assume your servers live on the same host or are
exposed publicly. mc-panel is built for a different (and probably more
common) shape: a small group of friends running a few servers on home or
co-located hardware, glued together by Tailscale. The panel itself is just
another Tailscale device; it talks to each server over SSH/SFTP for files
and over RCON for commands. The web UI sits behind both Tailscale _and_
its own username/password login so a stolen device key alone doesn't
hand someone full control.

## Requirements

- Node.js 18 or newer (LTS recommended)
- npm 9+
- A Tailscale tailnet, with the panel host and each Minecraft host on it
- SSH/SFTP access to each Minecraft host (password or key)
- RCON enabled on each Minecraft server (`enable-rcon=true`)

## Setup

1. **Clone the repo**

   ```
   git clone https://github.com/Qpero1/mc-web-interface.git
   cd mc-web-interface
   ```

2. **Install dependencies** (run this _before_ the password hash step)

   ```
   npm run install:all
   ```

   This installs both the backend and frontend.

3. **Create your config files**

   Copy the example configs and fill in your details.

   On macOS / Linux:

   ```
   cp config.example.json config.json
   cp servers.example.json servers.json
   cp .env.example .env
   ```

   On Windows (cmd.exe):

   ```
   copy config.example.json config.json
   copy servers.example.json servers.json
   copy .env.example .env
   ```

   On Windows (PowerShell):

   ```
   Copy-Item config.example.json config.json
   Copy-Item servers.example.json servers.json
   Copy-Item .env.example .env
   ```

4. **Generate a password hash**

   ```
   node scripts/hash-password.js "your-password-here"
   ```

   Paste the output into `config.json` under `auth.passwordHash` and pick
   a long random `panel.jwtSecret` (or set `JWT_SECRET` in `.env`).

5. **Run in development**

   ```
   npm run dev
   ```

   This starts the API on `http://localhost:8787` and the Vite dev server
   with HMR on `http://localhost:5173` (which proxies `/api` and the
   websocket back to the API). Hit Ctrl+C to stop both.

6. **Build for production**

   ```
   npm run build
   npm start
   ```

   The Express server will serve the bundled client from `client/dist/`.
   Open `http://<panel-host>:8787` (or whichever port you configured).

## Feature tour

- **Home** – every configured server in one place: status, online players,
  expandable real-time graphs for player count, CPU, and RAM, lifecycle
  buttons (Start/Stop/Restart), and a remove button. Activity log panel
  on the right shows every action the panel has taken.
- **Files** – SFTP file browser scoped to the server's directory. Browse
  with breadcrumbs, upload (multi-file), download, rename, delete,
  create folders.
- **Mods** – lists everything in `/mods`. Search by name, toggle
  enabled/disabled by renaming `.jar` ↔ `.jar.disabled`, drag-and-drop
  upload, delete with confirmation.
- **Worlds** – worlds in the server directory (detected by `level.dat`).
  Upload a zip (auto-extracts), download a world as zip, mark a world
  active (updates `level-name`), delete.
- **Players** – roster table compiled from `usercache.json`, the
  whitelist, ban lists, and recent log lines. Shows online status and
  the player's last-seen IP (private data — handle carefully).
  Per-row actions: whitelist/unwhitelist, kick, ban by name or IP,
  pardon.
- **Console** – live `tail -F logs/latest.log` streamed over Socket.io
  with INFO/WARN/ERROR color coding, an autoscroll toggle, and a
  command input with `/`-autocomplete for the common Minecraft commands.
- **Backups** – per-world backups stored under `<serverDir>/backups`.
  Create on demand, download, delete, or set an auto-backup schedule
  (1h / 3h / 6h / 12h / 24h) handled server-side by `node-cron`.
- **Config** – `server.properties` rendered as a labeled form with
  booleans as toggles and per-row hints when a restart is needed.
  Includes a raw-text toggle for advanced edits.

## Adding a new server

Open the Home tab and click **Add server**. You'll be asked for:

- Display name (e.g. _Survival_)
- Tailscale IP or hostname
- RCON port + password
- SSH port + credentials (password or private key path)
- Server directory on the remote host
- Optional start/stop/restart commands (e.g. `systemctl --user start minecraft`)

You can also pre-populate `servers.json` manually using
`servers.example.json` as a template. The file is gitignored.

## Adding a new tab / module (contributors)

The codebase is intentionally easy to extend.

**Backend** (`server/modules/<name>.js`): export a `registerXModule({ api, io, registry, rconManager, activityLog })` function and add it to the imports in `server/index.js`. The shared `registry` exposes `sftp(id)`, `runSsh(id, cmd)`, and `runLifecycle(id, action)`; `rconManager` handles pooled RCON; `activityLog.record(...)` writes to the activity log.

**Frontend** (`client/src/components/tabs/<Name>.jsx`): build a React component that calls the API through `lib/api.js` and uses the shared UI library in `components/ui`. Register the new tab in:

- `client/src/App.jsx` — the `TABS` map
- `client/src/components/Sidebar.jsx` — the `NAV` array

The selected server is available via `useServers()` (which wraps
`ServerContext`), and socket access via `useSocket()`.

## Tailscale setup

1. Install Tailscale on the panel host and on each Minecraft host
   (`https://tailscale.com/download`) and join all of them to the same
   tailnet.
2. Take note of each Minecraft host's Tailscale IP (`tailscale ip -4`) —
   this is what you'll enter as **host** for each server.
3. Allow SSH and the RCON port through any firewall on the Minecraft
   host, but only from the Tailscale interface — they don't need to be
   exposed publicly.
4. Run the panel on whichever device is most convenient (a small VPS, a
   Raspberry Pi at home, etc.) and access it via that host's Tailscale
   IP. Tailscale's ACLs can further restrict which devices can reach it.

## Security notes

- **Two layers of access control.** Tailscale establishes network-level
  trust; mc-panel adds username/password authentication so any device
  that has joined the tailnet still needs a credential to use the
  panel. Pick a strong password.
- **JWT secret.** The session token is signed with `panel.jwtSecret`
  (or `JWT_SECRET` from the environment). Use a long random value and
  treat it as a secret.
- **Player IP addresses are private data.** They're displayed in the
  Players tab because they're operationally useful (banning, identifying
  alts) but they're personal information — be careful who you share
  them with, and don't paste screenshots publicly.
- **What lives in git.** `config.json`, `servers.json`, `.env`, and
  `data/` are gitignored. RCON passwords, SSH passwords, and the JWT
  secret should never be committed.
- **Don't expose the panel publicly.** It is designed to live on
  Tailscale. There is no rate limiting, no CSRF protection beyond JWT,
  and no captcha — running it on the open internet is not supported.

## Contributing

PRs welcome. Try to keep:

- Every backend module a self-contained file under `server/modules/`,
  with a JSDoc block at the top.
- Every UI primitive in `client/src/components/ui/` and dark-mode aware.
- Every async operation wrapped in a try/catch with a `toast.error` on
  failure.

## License

[MIT](LICENSE)
