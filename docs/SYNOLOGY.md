# Home NAS storage on a Synology DS720+

The site stores files on "S3-compatible" storage: R2, Backblaze B2, or your NAS. DSM doesn't speak S3 by
itself, so the NAS runs two small pieces:

- **versitygw** (Versity S3 Gateway, Apache 2.0) puts an S3 address in front of an ordinary NAS folder. Every upload
  is a normal file at `docker/nas/data/<bucket>/<path>`: you can see it in File Station, and Hyper Backup and Btrfs
  snapshots protect it like anything else. There is no database to look after or repair.
- **Cloudflare Tunnel** (a Package Center package) gives the gateway a private, encrypted path to Cloudflare, so the
  site can reach it at `https://nas-s3.sxingxian.com` **without opening any port on your router**. The site runs on
  Cloudflare, so it needs *some* way in to your NAS; the tunnel is the safe one (the alternative is port forwarding
  plus your own certificate, which exposes the NAS directly).

```
sxingxian.com (Cloudflare Worker) ──HTTPS──▶ Cloudflare ──Tunnel──▶ Cloudflare Tunnel package ──▶ localhost:7070 (versitygw) ──▶ /volume1/docker/nas/data
```

> **Why not Garage or MinIO?** Garage is built for clusters spread over several sites; on a single NAS that adds
> layouts, an RPC secret and a metadata database for no benefit, and it kept crashing here. MinIO's free edition is no
> longer maintained. The site needs plain "put / get / delete a file", which versitygw does with nothing in between
> the S3 request and the file.

## 0 · Before you start

- **DSM 7.2 or later** with **Container Manager** (Package Center). DS720+ is Intel (x86-64), so it runs containers.
- **Memory:** the gateway and the tunnel together use well under 200 MB.
- **Remove the old Garage project** if you created one: Container Manager → **Project** → `garage` → **Action → Delete**
  (it also offers to remove its containers, including any `cloudflared` container: remove it, the tunnel now runs
  as a package). Then delete the `docker/garage` folder in File Station. Nothing in it is used by the site yet.
- **Make two random keys** with your password manager. Use **letters and digits only** (symbols such as `$`, `#` or
  `:` break the settings file):
  - an **access key**, 20 characters
  - a **secret key**, 40 characters.

  They are the only way into the gateway. They go in the settings file below and in Cloudflare (step 4), nowhere else.

## 1 · The gateway

1. In File Station create the folders `docker/nas` and `docker/nas/data`.
2. **Container Manager → Project → Create**:
   - Project name `nas`, path `docker/nas`, source **Create docker-compose.yml**, and paste:

   ```yaml
   services:
     versitygw:
       image: versity/versitygw:latest   # after the first start, pin the version shown in the log (see "Gateway updates")
       container_name: versitygw
       restart: unless-stopped
       environment:
         - ROOT_ACCESS_KEY=PASTE_ACCESS_KEY
         - ROOT_SECRET_KEY=PASTE_SECRET_KEY
         - VGW_BACKEND=posix
         - VGW_BACKEND_ARG=/data
       volumes:
         - ./data:/data
       ports:
         - "127.0.0.1:7070:7070"   # reachable only from the NAS itself (the tunnel), not from your LAN or the internet
   ```

   - Replace `PASTE_ACCESS_KEY` and `PASTE_SECRET_KEY` with your two keys.
   - Untick "Set up web portal", then **Next → Done**. The project builds and starts.
3. **Check it started:** Container Manager → **Container** → `versitygw` → **Log**. It should show the gateway
   listening (port 7070) and no errors.

### Create the bucket (no SSH needed)

Control Panel → **Task Scheduler → Create → Scheduled Task → User-defined script**:
- **General:** name `nas-bucket`, user **root**, untick **Enabled** (so it only runs when you press Run).
- **Task Settings → Run command** (put your two keys in):

  ```sh
  {
    /usr/local/bin/docker run --rm --network host \
      -e AWS_ACCESS_KEY_ID=PASTE_ACCESS_KEY -e AWS_SECRET_ACCESS_KEY=PASTE_SECRET_KEY -e AWS_DEFAULT_REGION=us-east-1 \
      amazon/aws-cli --endpoint-url http://127.0.0.1:7070 s3 mb s3://sxingxian-media
    /usr/local/bin/docker run --rm --network host \
      -e AWS_ACCESS_KEY_ID=PASTE_ACCESS_KEY -e AWS_SECRET_ACCESS_KEY=PASTE_SECRET_KEY -e AWS_DEFAULT_REGION=us-east-1 \
      amazon/aws-cli --endpoint-url http://127.0.0.1:7070 s3 ls
  } > /volume1/docker/nas/setup.log 2>&1
  ```

Select the task → **Run**, wait a minute, then open `docker/nas/setup.log` (Text Editor package or download it). You
should see `make_bucket: sxingxian-media` and then the bucket in the list, and a `sxingxian-media` folder appears in
`docker/nas/data`. This also proves the keys work. **Then delete the task** (it contains your keys) and the log.

If the log shows **permission denied**, the container can't write to `docker/nas/data`: File Station → right-click
`data` → **Properties → Permission → Create** → *Everyone* → **Read & Write**, apply to this folder, sub-folders and
files → Save, and run the task again. ("Everyone" means accounts on your NAS, not the internet; keep the `docker`
shared folder itself unshared.)

## 2 · Cloudflare Tunnel (Package Center)

1. **Add the SynoCommunity package source** (once): Package Center → **Settings**
   - **General → Trust Level:** *Synology Inc. and trusted publishers*.
   - **Package Sources → Add:** name `SynoCommunity`, location `https://packages.synocommunity.com/` → OK.
2. **Create the tunnel:** Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**,
   name it `nas`. On the install screen pick any system (e.g. Docker) and copy just the **token**: the long string
   after `--token` in the command it shows. Keep it private; anyone with it can run your tunnel.
3. **Install it on the NAS:** Package Center → **Community** → **Cloudflare Tunnel** → **Install**, and paste the token
   when it asks. Back in the Cloudflare dashboard the tunnel turns **Healthy**.
4. **Point it at the gateway:** in the tunnel → **Public hostname → Add**: subdomain `nas-s3`, domain
   `sxingxian.com`, service **HTTP**, URL `localhost:7070` → Save.

To check it: open `https://nas-s3.sxingxian.com` in a browser. An XML "AccessDenied" (or similar) error is
**good**: the gateway answered and refused a request without keys. A Cloudflare error page means the tunnel or the
hostname isn't right yet.

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
| `NAS_S3_REGION` | `us-east-1` (versitygw's default region) |
| `NAS_S3_ACCESS_KEY_ID` | your access key |
| `NAS_S3_SECRET_ACCESS_KEY` | your secret key |
| `NAS_ACCESS_CLIENT_ID` | service token Client ID (step 3, optional) |
| `NAS_ACCESS_CLIENT_SECRET` | service token Client Secret (step 3, optional) |

Then in the admin: **Media → Upload**. "Home NAS" is now selectable; upload a photo and a PDF and open the story
to check they appear. The files show up under `docker/nas/data/sxingxian-media/` in File Station.

If an upload fails with a **signature or region** error, check that `NAS_S3_REGION` is `us-east-1`; if it fails with
**access denied**, check the two keys match `docker-compose.yml` exactly.

## Good to know

- **Leave the files alone in File Station.** You can look at and back them up, but don't rename, move or delete them:
  the site keeps a record of each file's path and would show a broken image. Delete media from the admin instead.
- **Videos** still go to R2 only (Cloudflare's terms for serving video).
- **If the NAS is off or offline**, files stored on it can't be shown until it's back. Keep anything important
  (the featured cover, CV files) on R2, or copy it to both.
- **Tunnel updates** come through Package Center (Community tab). If the tunnel ever stops, Package Center →
  Installed → Cloudflare Tunnel → **Run**; its log is under the package's details.
- **Gateway updates:** after the first start, note the version in the `versitygw` log and change `latest` to that tag in
  `docker-compose.yml`, so it only updates when you choose to. To update, read the release notes on
  github.com/versity/versitygw, change the tag, then **Project → Action → Build**.
- **Changing the keys:** edit both in `docker-compose.yml`, rebuild the project, and update the two Worker secrets.
- **Backups:** Hyper Backup the `docker/nas/data` folder (plain files, no need to stop anything), or rely on Btrfs
  snapshots of the `docker` shared folder.
- Nothing about the NAS (address, keys, tokens) is ever sent to visitors: the site fetches from it and serves the file
  itself at `/media/<id>`.
