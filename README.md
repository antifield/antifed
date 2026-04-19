# Antifed

Antifed is the Discord moderation bot for the [Antifield](https://discord.gg/noid) server. It handles warnings, bans, staff-only notes, infraction history with paginated embeds, and Better Stack paging integration.

This bot does not include length-wise bans. We give all bans permanently with little to no chance of appeal.

## Commands

### `/mod` - Moderation actions

| Subcommand                                                       | Description                             | Permission       |
| ---------------------------------------------------------------- | --------------------------------------- | ---------------- |
| `/mod warn @user [reason] [silent?]`                             | Warn a user, DMs them the reason        | Moderate Members |
| `/mod kick @user [reason] [silent?]`                             | Kick a user from the server             | Moderate Members |
| `/mod softban @user [reason] [silent?]`                          | Ban + immediate unban to purge messages | Moderate Members |
| `/mod ban @user [reason] [duration] [delete_messages] [silent?]` | Ban a user, DMs them before banning     | Moderate Members |

### `/infraction` - Infraction management

| Subcommand                       | Description                                     | Permission       |
| -------------------------------- | ----------------------------------------------- | ---------------- |
| `/infraction check @user [type]` | View a user's infractions (paginated)           | Moderate Members |
| `/infraction remove [id]`        | Deactivate an infraction (auto-unbans for bans) | Moderate Members |
| `/infraction clear @user`        | Clear all infractions for a user                | Dev only         |

### `/note` - Staff notes

| Subcommand                  | Description                             | Permission       |
| --------------------------- | --------------------------------------- | ---------------- |
| `/note check @user`         | View staff notes for a user (paginated) | Moderate Members |
| `/note add @user [content]` | Add a staff-only note (no DM to user)   | Moderate Members |
| `/note remove [id]`         | Delete a specific note                  | Moderate Members |
| `/note clear @user`         | Delete all notes for a user             | Dev only         |

### `/user` - User lookup

| Subcommand           | Description                                               | Permission       |
| -------------------- | --------------------------------------------------------- | ---------------- |
| `/user info @user`   | Overview with ban/warn/note counts and drill-down buttons | Moderate Members |
| `/user audit @staff` | View all moderation actions taken by a staff member       | Moderate Members |

### `/page` and `/botinfo`

| Command                      | Description                                | Permission    |
| ---------------------------- | ------------------------------------------ | ------------- |
| `/page [reason] [critical?]` | Page via Better Stack                      | Administrator |
| `/botinfo`                   | Bot diagnostics (uptime, memory, db stats) | Dev only      |

Reason is required for all `/mod` actions and is DM'd to the user. DM failure is shown in the confirmation embed. Confirmation is public in-channel by default; pass `silent: true` to keep it ephemeral. The mod-log always receives the full action regardless. Notes and infractions never expire, and are only manual removal.

## Development

```bash
# copy env, fill in credentials
cp .env.example .env

# (DOCKER IS NEEDED) start libsql, push schema, run
make dev
```

### Services

- libsql: `localhost:9120`

### Make targets

- `make dev` - Full pipeline: Docker containers, health checks, schema push, bot (cleans up on exit)
- `make dev-noinf` - Bot only (assumes Docker already running)
- `make dev-infra` / `make dev-infra-stop` - Docker containers up/down
- `make check` - Lint and format with oxlint + oxfmt
- `make test` (or `bun test`) - Run test suite
- `make db-push` / `make db-generate` / `make db-migrate` / `make db-studio` - Drizzle helpers
- `make help` - List all targets

### Stack

bun, discord.js, drizzle orm, libsql, t3-env, zod, evlog - hosted on railway + turso

## License

[antifield/antifed](https://github.com/antifield/antifed) is licensed under the [GNU Affero General Public License v3.0](LICENSE).

You must state all significant changes made to the original software, make the source code available to the public with credit to the original author, original source, and use the same license.

> (c) 2026 Antifield LTD | Registered UK Company No. 15988228 | ICO Reference No. ZB857511
