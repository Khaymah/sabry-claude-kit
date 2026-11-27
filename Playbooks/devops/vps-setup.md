# Fresh VPS hardening

- **Situation:** new Ubuntu VPS from a provider, "secure the server", "set up the box", bots hammering SSH, a client server handed over with root password login.
- **Skip when:** a managed platform (PaaS, managed Kubernetes) owns the OS; or the server already passed this checklist (re-run Verify only).
- **Decision:** one non-root deploy user with sudo, SSH by key only, deny-by-default firewall opening 22/80/443, automatic security patches, server clock in UTC. Application time zones are an app concern (`backend/data/time-zones.md`), never a server setting.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any server reachable from the internet |
| Standard | Production for a paying client: fail2ban, unattended upgrades, reboot window, separate service user |
| Advanced | Regulated data, several servers: SSH on a bastion or VPN, auditd, provider-level firewall, CIS checks |

## Rules

### Minimum — always, never cut

- First login as root only to create the deploy user, install its public key, and lock root and passwords. Never leave the root password or root SSH login enabled.
- Put SSH settings in `/etc/ssh/sshd_config.d/10-hardening.conf` (the main file can be overridden by cloud-init drop-ins). Run `sshd -t` before reloading, and keep the current session open until a second session logs in.
- `PasswordAuthentication no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`, `AllowUsers deploy`.
- Firewall: `ufw default deny incoming`, allow `OpenSSH`, `80`, `443` only. PostgreSQL (5432), the Bun port and pgbouncer are never opened; they listen on `127.0.0.1`.
- Allow SSH in ufw before enabling it. Enabling first locks you out.
- Server clock: `timedatectl set-timezone UTC` and `systemd-timesyncd` active.

### Standard — adds

- `fail2ban` with the `sshd` jail (`maxretry 4`, `bantime 1h`, `findtime 10m`), with your own office IP in `ignoreip`.
- `unattended-upgrades` for the security pocket only, with `Automatic-Reboot "false"`; reboot is a planned weekly window because a kernel update needs it. `/var/run/reboot-required` is checked by the monitor (`devops/monitoring-logs.md`).
- The app runs as a separate system user (`app`, no shell, no sudo), not as `deploy`. `deploy` owns the release directories; `app` only reads them.
- 1–2 GB swap file on small VPSs, `vm.swappiness=10`, so a spike does not trigger the OOM killer on Postgres.
- Provider snapshot enabled, taken before every OS-level change.

### Advanced — adds

- SSH reachable only through a VPN or a bastion; port 22 closed publicly.
- `auditd` rules on `/etc/ssh`, `/etc/sudoers.d`, and the app's `.env`.
- Provider firewall in addition to ufw, so a mistaken `ufw disable` does not expose the box.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Provider image ships `50-cloud-init.conf` with `PasswordAuthentication yes` | Drop-ins are read in lexical order and the first value wins, so the hardening file is named `10-…` and `sshd -T` is checked, not the file |
| Your home IP changes (Egyptian ISPs rotate) | Key auth still works from anywhere; never IP-allowlist SSH on a dynamic IP, ban lists are the control |
| `ufw enable` run over SSH without allowing 22 | Session dies; recover from the provider's web console, so know where it is before starting |
| Data at 100×: disk and logs | journald capped (`SystemMaxUse=500M`), so a log flood cannot fill the root disk and stop Postgres (`devops/monitoring-logs.md`) |
| Twice / parallel: setup script run twice | Idempotent: `id deploy` guard, `ufw allow` and `sed` are repeatable, `authorized_keys` is not appended twice |
| Unattended upgrade restarts a service mid-deploy | Needrestart in automatic mode `a`; deploys use the release switch, so a restart is just a normal one |
| Server in Cairo but `date` shows UTC | Correct. Cron times are written in UTC; Cairo shifts with DST, so never compute "9 am Cairo" by hand |

## Example — Standard, Ubuntu 24.04

```bash
set -euo pipefail
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers deploy
MaxAuthTries 3
CONF
sshd -t && systemctl reload ssh

apt-get update
apt-get install -y ufw fail2ban unattended-upgrades
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban

dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone UTC
timedatectl set-ntp true
useradd --system --home /srv/app --shell /usr/sbin/nologin app || true
```

Other hosts: managed VPS panels (Hetzner, DigitalOcean) offer a cloud firewall; apply it as well, never instead of ufw.

## Verify

- [ ] `[M]` `ssh -o PubkeyAuthentication=no deploy@host` is refused; `ssh root@host` is refused; `sshd -T | grep -E 'passwordauthentication|permitrootlogin'` shows `no`.
- [ ] `[M]` From outside, `nmap -p 22,80,443,5432,3000 host` shows only 22, 80, 443 open.
- [ ] `[M]` `timedatectl` shows `Time zone: UTC` and `System clock synchronized: yes`.
- [ ] `[S]` `fail2ban-client status sshd` lists the jail; `unattended-upgrade --dry-run` succeeds.
- [ ] `[S]` `ps -o user= -C bun` shows `app`, not `root` or `deploy`.
- [ ] `[A]` Port 22 is unreachable from a non-VPN address.

## Pitfalls

- **Disabling password login before testing the key** → locked out → second session first.
- **Running the app as root or as `deploy`** → a code-execution bug owns the server and the deploy key → separate `app` user.
- **Binding Postgres or the app to `0.0.0.0` "temporarily"** → found by scanners in hours → `127.0.0.1` and an SSH tunnel for admin access.
- **Docker publishing ports** (if the client forces Docker) → bypasses ufw through iptables → publish on `127.0.0.1:` only.

## Related

`devops/nginx-tls.md` · `devops/monitoring-logs.md` · `devops/postgres-ops.md` · `security/INDEX.md`
