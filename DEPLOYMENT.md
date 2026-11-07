# EC2 deployment

This app runs as a React/Vite site served by Nginx, with the Express API bound to localhost. SQLite is stored separately under `/var/lib/family-bonus` so code updates do not replace the database.

## Before connecting

1. Point `familybonus.duckdns.org` to the EC2 public IPv4 address.
2. In the EC2 security group, allow SSH from **My IP**, and HTTP/HTTPS from the internet. Do not add an inbound rule for port `5000`.
3. Use Ubuntu x86_64 with Node.js `22.12` or newer. Vite 8 requires `^20.19.0 || >=22.12.0`, and the API's SQLite package requires Node.js 22 or newer.

## Install the app

Run these commands in the EC2 terminal. The repository is cloned into `/srv/family-bonus-site`.

```bash
sudo mkdir -p /srv/family-bonus-site /var/lib/family-bonus /etc/family-bonus
sudo chown ubuntu:ubuntu /srv/family-bonus-site
sudo useradd --system --no-create-home --shell /usr/sbin/nologin familybonus
sudo chown familybonus:familybonus /var/lib/family-bonus
git clone https://github.com/subhradip00007/family-bonus-site.git /srv/family-bonus-site
```

If the GitHub repository is private, configure a read-only deploy key for the EC2 instance before cloning. Do not paste a personal access token into the terminal or chat.

## Configure Google sign-in and secrets

Create the client build environment file and use the same Google OAuth client ID as the API:

```bash
cd /srv/family-bonus-site/client
cp .env.example .env.production
nano .env.production
```

Set `VITE_GOOGLE_CLIENT_ID` to the Google OAuth client ID. In Google Cloud Console, add `https://familybonus.duckdns.org` as an authorized JavaScript origin.

Create the server environment file:

```bash
openssl rand -hex 32
sudo cp /srv/family-bonus-site/server/.env.example /etc/family-bonus/family-bonus.env
sudo nano /etc/family-bonus/family-bonus.env
```

Set `GOOGLE_CLIENT_ID` to the same OAuth client ID, `DEV_EMAIL` to your developer Google account, and replace `JWT_SECRET` with the output from `openssl rand -hex 32`. Keep `CLIENT_URL=https://familybonus.duckdns.org`, `HOST=127.0.0.1`, `TRUST_PROXY_HOPS=1`, and `DATABASE_PATH=/var/lib/family-bonus/bonus.db`.

Protect the environment file:

```bash
sudo chown root:familybonus /etc/family-bonus/family-bonus.env
sudo chmod 640 /etc/family-bonus/family-bonus.env
```

## Build and install dependencies

```bash
cd /srv/family-bonus-site/client
npm ci
npm run build
cd ../server
npm ci --omit=dev
```

## Start the API and Nginx

```bash
sudo cp /srv/family-bonus-site/deploy/systemd/family-bonus.service /etc/systemd/system/family-bonus.service
sudo systemctl daemon-reload
sudo systemctl enable --now family-bonus
sudo apt install -y nginx
sudo cp /srv/family-bonus-site/deploy/nginx/family-bonus.conf /etc/nginx/sites-available/family-bonus
sudo ln -s /etc/nginx/sites-available/family-bonus /etc/nginx/sites-enabled/family-bonus
sudo nginx -t
sudo systemctl reload nginx
```

If Nginx's default site conflicts, disable `/etc/nginx/sites-enabled/default` and reload Nginx. The included site serves the React single-page app, proxies `/api` to the private API port, sets basic browser security headers, and allows JSON logo requests up to 2 MB.

After DNS points to EC2 and HTTP works, install HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d familybonus.duckdns.org
```

## Operations

- Check the API service with `sudo systemctl status family-bonus` and `sudo journalctl -u family-bonus -n 100`.
- Keep port `5000` closed in the EC2 security group; Nginx is the only public web entry point.
- Back up `/var/lib/family-bonus/bonus.db` and create EBS snapshots. The database is not stored in the Git working tree.
- The download, contact panel, and deployment fixes must be pushed to GitHub before this EC2 clone can include them.
