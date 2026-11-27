# Backups and restore

- **Situation:** "back up the database", "what if the server dies", client asks about recovery, accidental `DELETE`, "can we go back to yesterday 3 pm", uploaded files backup.
- **Skip when:** the database is managed and its provider's point-in-time recovery is enabled and tested; then only files and the restore drill remain.
- **Decision:** nightly `pg_dump` (custom format) plus continuous WAL archiving (`pgBackRest` or `wal-g`) to an S3-compatible bucket in another provider or region, client-side encrypted, with retention rules and a monthly restore into a scratch database that checks row counts. A backup never restored is not a backup.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any real data: nightly dump, off-server, encrypted, 14 days, restore tested once |
| Standard | Paying client: WAL archiving (RPO minutes), 30 daily + 12 monthly, monthly restore drill, files backed up, failure alert |
| Advanced | Money at volume or SLA: base backups weekly, restore time measured against an RTO, second region, immutable (object-lock) bucket |

## Rules

### Minimum — always, never cut

- Backups leave the server. A dump on the same disk dies with the disk; the bucket belongs to a different provider account than the VPS.
- Encrypt before upload (`age` or `gpg`, public key on the server, private key in the owner's password manager and one offline copy). The server can write backups but cannot decrypt them.
- Dump with `pg_dump -Fc --no-owner` as the `postgres` user over the local socket; credentials from `~/.pgpass` or peer auth, never on the command line.
- The job fails loudly: non-zero exit sends a message, and a heartbeat check (healthchecks.io-style ping on success) alerts when no backup arrived within 26 hours.
- Verify on the server before encrypting: size above a floor (e.g. 50% of yesterday) and `pg_restore --list` on the plaintext dump (it needs the unencrypted file, which lives only in a `postgres`-owned `700` directory until encrypted). After upload, compare the remote size via `rclone lsf`; the write-only key cannot read the object back. Prune old backups only after both pass.
- Restore tested before launch and then every month (below). The restore procedure is written down where the owner can find it without the server.
- Bucket credentials are write-only plus list (no delete) for the backup user; deletion is done by lifecycle rules.

### Standard — adds

- Continuous WAL archiving with `archive_mode = on` and `archive_command` from pgBackRest or wal-g; a full base backup weekly, differentials daily. This gives point-in-time recovery to any second after the first base backup.
- Retention by lifecycle rule: 30 daily, 12 monthly, 1 yearly if the client's contract needs it. State it in the project memory; it must agree with `backend/data/data-retention.md`, because a deleted customer's data sits in backups until they expire.
- Monthly restore drill on a scratch machine or a temporary database: restore the latest backup, run a script comparing row counts of key tables with production (tolerance equals the growth since the dump), and run `SELECT count(*)` on `Invoices`, `Orders`, `Users`, then record the date and the restore time.
- Uploaded files (`/srv/app/shared/uploads`): `restic` or `rclone sync` with versioning to the bucket nightly, not `--delete` without versioning. Database rows and files are restored from the same day, or file references dangle.
- Config worth backing up too: `/etc/app`, `/etc/nginx`, systemd units (or keep them in the repo and rebuild).

### Advanced — adds

- Object-lock (WORM) bucket for 30 days so ransomware or a leaked key cannot erase history.
- Measured RTO: the drill times a full restore plus app start; if it exceeds the client's target, add a warm standby (streaming replica).
- Second copy in another country or provider.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Dump runs while data changes | `pg_dump` is a consistent snapshot; parallel `-j` dumps use `--snapshot` from a single export, never separate connections without it |
| Restore says success but a table is empty | The drill compares counts; mismatch above tolerance fails the drill and alerts |
| Data at 100×: the dump takes 6 hours and locks nothing but slows queries | Switch to base backup plus WAL, run on a replica or off-peak, `nice` and `ionice` |
| Twice / parallel: two backup jobs overlap | `flock` on the script; the second exits quietly and logs |
| "Undo the delete we made at 3 pm" | PITR to 14:59 UTC-converted time into a new instance, export the rows, apply to production; never overwrite production in place |
| Disk full from WAL because the bucket is unreachable | `archive_command` fails and WAL piles up; alert on `pg_wal` size and on `pg_stat_archiver.failed_count` rising |
| Bucket key is leaked | Backup user cannot delete or read; rotate and keep the age private key elsewhere |
| User asks to delete their data (GDPR-style) | Live data deleted now; backups expire by retention, documented in the privacy answer |
| Cairo midnight vs UTC | Cron runs in UTC; the file name carries the UTC timestamp, the drill logs both |

## Example — Standard, bash and cron

```bash
set -euo pipefail
exec 9>/var/lock/pg-backup.lock
flock -n 9 || exit 0

Stamp=$(date -u +%Y%m%dT%H%M%SZ)
Plain="/var/backups/db/app-$Stamp.dump"
File="$Plain.age"
trap 'rm -f "$Plain"' EXIT

pg_dump -Fc --no-owner app > "$Plain"

Size=$(stat -c %s "$Plain")
[ "$Size" -gt 1048576 ] || { echo "dump too small: $Size"; exit 1; }
pg_restore --list "$Plain" >/dev/null

age -r "$(cat /etc/app/backup.pub)" < "$Plain" > "$File"
rm -f "$Plain"

rclone copyto "$File" "backup:app-backups/daily/$(basename "$File")"
[ "$(rclone lsf --format s "backup:app-backups/daily/$(basename "$File")")" = "$(stat -c %s "$File")" ]

find /var/backups/db -name '*.age' -mtime +2 -delete
curl -fsS -m 10 --retry 3 "$(cat /etc/app/heartbeat.url)" >/dev/null
```

```bash
set -euo pipefail
Latest=$(rclone lsf backup:app-backups/daily/ | sort | tail -1)
rclone copyto "backup:app-backups/daily/$Latest" /tmp/drill.dump.age
age -d -i /root/restore.key /tmp/drill.dump.age > /tmp/drill.dump
dropdb --if-exists app_drill
createdb app_drill
pg_restore --no-owner -d app_drill /tmp/drill.dump
for T in "Users" "Orders" "Invoices"; do
  psql -At -d app_drill -c "select '$T', count(*) from \"$T\""
done
dropdb app_drill
rm -f /tmp/drill.dump /tmp/drill.dump.age
```

```
15 1 * * * postgres /usr/local/bin/pg-backup.sh
```

Provisioning creates the directory once: `install -d -o postgres -g postgres -m 700 /var/backups/db` (the job runs as `postgres` and cannot create it under `/var/backups`). The private key `restore.key` is on the drill machine only for the drill. Other stacks: managed Postgres (RDS, Supabase) has PITR in settings; still run the drill with a logical dump copy.

## Verify

- [ ] `[M]` A file exists in the bucket from the last 26 hours; the bucket is not on the VPS provider; the file is unreadable without the private key.
- [ ] `[M]` Stop the heartbeat for a day in staging: an alert arrives.
- [ ] `[M]` Restore the latest dump to a scratch database; the key tables have rows.
- [ ] `[S]` `SELECT * FROM pg_stat_archiver` shows `last_archived_time` within a few minutes and `failed_count` flat.
- [ ] `[S]` PITR to a time 10 minutes ago yields the data as of then; drill date and duration recorded.
- [ ] `[A]` Deleting an object from the bucket with the backup key is denied.

## Pitfalls

- **Backups only on the same VPS** → provider loses the server, loses both → separate provider.
- **Never testing a restore** → discovering an empty or corrupt dump during the incident → monthly drill.
- **Encryption key stored beside the backups** → no protection → password manager plus offline copy.
- **`rclone sync` of uploads with deletes** → an accidental `rm` mirrored → versioned bucket, `copy` not `sync`.
- **Dump password in the command line** → visible in `ps` → `.pgpass` or peer auth.

## Related

`devops/postgres-ops.md` · `devops/monitoring-logs.md` · `backend/data/data-retention.md` · `backend/files/uploads.md` · `quality/observability/alerting.md`
