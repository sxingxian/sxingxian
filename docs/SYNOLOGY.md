# Home NAS storage on a Synology DS720+

The site stores files on "S3-compatible" storage: R2, Backblaze B2, or your NAS. DSM doesn't speak S3 by
itself, so the NAS runs two small containers:

- **Garage**, a lightweight S3 server, keeps the files on a NAS shared folder.
- **cloudflared** (Cloudflare Tunnel) gives Garage a private, encrypted path to Cloudflare, so the site can reach it at
  `https://nas-s3.sxingxian.com` **without opening any port on your router**.

> Why not MinIO? Its free community edition stopped shipping Docker images in October 2025 and went into
> maintenance mode, so it no longer gets regular security fixes. Garage is actively maintained and needs far less memory.

```
sxingxian.com (Cloudflare Worker) ──HTTPS──▶ Cloudflare ──Tunnel──▶ cloudflared ──▶ Garage :3900 ──▶ /volume1/docker/garage
```

## 0 · Before you start

- **DSM version.** DS720+ is an Intel (x86-64) model, so it runs containers. On **DSM 7.0** the package is
  called **Docker**; from **DSM 7.2** it is **Container Manager**, with Docker Compose built into the UI.
  Updating is recommended: **Control Panel → Update & Restore**, install the latest DSM 7.2.x your NAS is offered
  (take a configuration backup first). The steps below show Container Manager; on DSM 7.0 use the Docker package
  plus SSH (noted where different).
- **Memory.** Garage and cloudflared together use roughly 100–200 MB. The DS720+'s 2 GB is enough.
- **A shared folder for the data**, e.g. `docker` (Container Manager creates it). Btrfs snapshots and Hyper Backup
  can protect it like any other folder.

## 1 · Garage

1. In File Station create `docker/garage/meta`, `docker/garage/data`, and a file `docker/garage/garage.toml`:

   ```toml
   metadata_dir = "/var/lib/garage/meta"
   data_dir = "/var/lib/garage/data"
   db_engine = "sqlite"
   replication_factor = 1

   rpc_bind_addr = "[::]:3901"
   rpc_public_addr = "127.0.0.1:3901"
   rpc_secret = "<64 hex characters, see below>"

   [s3_api]
   s3_region = "garage"
   api_bind_addr = "[::]:3900"
   root_domain = ".s3.garage.localhost"
   ```

   Make `rpc_secret` with **any** random generator that gives 64 hex characters (for example `openssl rand -hex 32`
   over SSH). Don't reuse it anywhere else. Compare with the Garage quick-start page for your version
   (garagehq.deuxfleurs.fr → Documentation → Quick start) in case a key has been renamed.

2. **Container Manager → Project → Create**, path `docker/garage`, and this `compose.yaml`:

   ```yaml
   services:
     garage:
       image: dxflrs/garage:v2.3.0   # pin a version; update deliberately
       container_name: garage
       restart: unless-stopped
       volumes:
         - ./garage.toml:/etc/garage.toml:ro
         - ./meta:/var/lib/garage/meta
         - ./data:/var/lib/garage/data
       networks: [s3]
       # No "ports:" — Garage is reached only through the tunnel, never from your LAN or the internet.
     cloudflared:
       image: cloudflare/cloudflared:latest
       container_name: cloudflared
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         - TUNNEL_TOKEN=PASTE_THE_TOKEN_HERE   # from step 2 · 2 (keep this file private)
       networks: [s3]
   networks:
     s3: {}
   ```

   Leave `cloudflared` out until step 3 has given you the token (or start the project and fill the token in then).
   *DSM 7.0:* save the file over SSH and run `sudo docker-compose up -d` in `/volume1/docker/garage`.

3. Set up Garage once (Container Manager → Container → `garage` → Terminal → Create → `sh`, or over SSH with
   `sudo docker exec -it garage /garage …`):

   ```sh
   /garage status                                   # shows this node's ID
   /garage layout assign -z home -c 500G <NODE_ID>  # capacity you want to give it
   /garage layout apply --version 1
   /garage bucket create sxingxian-media
   /garage key create sxingxian-site                # prints the Key ID (GK…) and Secret key — copy both now
   /garage bucket allow --read --write sxingxian-media --key sxingxian-site
   ```

   Keep the key ID and secret somewhere safe: they go into Cloudflare in step 4 and nowhere else.

## 2 · Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, name it `nas`.
2. Choose **Docker** and copy the token from the command it shows (the long string after `--token`).
   Paste it into `compose.yaml` in place of `PASTE_THE_TOKEN_HERE` (Container Manager → Project → `garage` → edit), and start
   the `cloudflared` container. The tunnel turns **Healthy**.
3. **Public hostname:** subdomain `nas-s3`, domain `sxingxian.com`, service **HTTP** → `garage:3900`.

## 3 · (Recommended) Only the site may use that address

Without this, the S3 address is public but useless without the secret key. With it, Cloudflare refuses every request
that doesn't also carry a service token, so even a leaked key can't be used from elsewhere.

1. **Zero Trust → Access → Service auth → Service tokens → Create**, name `sxingxian-site`. Copy the
   Client ID and Client Secret (shown once).
2. **Access → Applications → Add → Self-hosted**, domain `nas-s3.sxingxian.com`. Add a policy with action
   **Service Auth** that includes that service token. No other policies.

## 4 · Tell the site

Cloudflare → **Workers & Pages → sxingxian → Settings → Variables and Secrets**, add as **Secrets**:

| Name | Value |
| --- | --- |
| `NAS_S3_ENDPOINT` | `https://nas-s3.sxingxian.com` |
| `NAS_S3_BUCKET` | `sxingxian-media` |
| `NAS_S3_REGION` | `garage` |
| `NAS_S3_ACCESS_KEY_ID` | the Garage key ID (`GK…`) |
| `NAS_S3_SECRET_ACCESS_KEY` | the Garage secret key |
| `NAS_ACCESS_CLIENT_ID` | service token Client ID (step 3, optional) |
| `NAS_ACCESS_CLIENT_SECRET` | service token Client Secret (step 3, optional) |

Then in the admin: **Media → Upload**. "Home NAS" is now selectable; upload a photo and a PDF and open the story
to check they appear.

## Good to know

- **Videos** still go to R2 only (Cloudflare's terms for serving video).
- **If the NAS is off or offline**, files stored on it can't be shown until it's back. Keep anything important
  (the featured cover, CV files) on R2, or copy it to both.
- **Updates:** change the image tag in `compose.yaml` and re-deploy the project. Read Garage's release notes first;
  back up `docker/garage` before a major version.
- **Backups:** Hyper Backup the `docker/garage` folder (stop the `garage` container first for a clean copy, or use a
  Btrfs snapshot).
- Nothing about the NAS (address, keys, tokens) is ever sent to visitors: the site fetches from it and serves the file
  itself at `/media/<id>`.
