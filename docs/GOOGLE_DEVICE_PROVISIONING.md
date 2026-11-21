# Native Google device client provisioning

The recorder uses Google's **TVs and Limited Input devices** OAuth client, with `drive.file` access. A distributed native application cannot keep its application identity confidential. Its device `client_id` and `client_secret` are extractable from a release; they are not a user's consent, Google account, access token, or refresh token. They must not be confused with a confidential web/server client secret.

Keep all actual client credentials out of the public source repository. Google explicitly prohibits committing OAuth client credentials to public code repositories. User tokens and account data must never be included in any build or release asset.

References: [Google device authorization](https://developers.google.com/identity/protocols/oauth2/limited-input-device), [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).

## Source builds

Official MGU Store installs use the provisioned release catalog. Select the default releases channel; branch/source builds require your own client.

`node scripts/build-release.js` creates the normal, unprovisioned source artifacts and Store app package. It never embeds a Google device identity. A source builder must supply their own Google device client privately before using native Remote Backup. To point the generated Store catalog at a fork, set `BV_CATALOG_REPOSITORY=OWNER/REPOSITORY` for the build; the default remains `Hexphase/BimmerVision`.

The recorder first reads its existing private client configuration at `/var/opt/bimmervision-recorder/google-drive-client.json` (or the configured `BV_GOOGLE_CLIENT_FILE` path). Existing ownership, regular-file, non-symlink, 16 KiB limit, and owner-only permission checks remain in place. An unsafe or malformed private file fails closed; it does not silently select another client. When the private file is absent, an official provisioned recorder release can use its bundled `google-device-client.json`.

## Stage a provisioned release outside the checkout

Create a private, owner-only JSON file outside every source checkout. It must contain **only** `client_id` and `client_secret`, either at the top level or in a single `installed` object. Use the actual native device client from the Google Cloud console. Do not supply a web client export, account information, project metadata, user tokens, or any additional fields. Client identifiers and `GOCSPX-` secrets are format checked; input must be a regular, non-symlink file owned by the build user with no group/other permissions.

```sh
BV_GOOGLE_DEVICE_CLIENT_FILE="$HOME/.config/bimmervision/google-device-client.minimal.json" \
  node scripts/build-release.js --release-dir /absolute/external/release-0.2.79
```

The output directory must be empty and outside every Git checkout. Setting `BV_GOOGLE_DEVICE_CLIENT_FILE` without this explicit staging mode is rejected before artifacts are written. The script never prints client values.

Staging writes only to that external directory:

- The ordinary app archive, without device client credentials.
- The recorder archive containing the two-field native device identity and its matching component-file checksum.
- `catalog.json` with versioned GitHub Release artifact URLs and matching sizes/checksums.
- `store-icon.png` and `CAR-SHA256SUMS`, covering both archives, the catalog, and icon.

Source files, `recorder/component.json`, the checkout's archives/catalog/checksums, and `idrive/store-package.tgz` are not changed by staging. Publish the staged files as release assets only after normal release verification. Do not copy the provisioned recorder archive or its client JSON into the source repository. The catalog and checksum text contain no client values and can be reviewed separately when updating the public catalog.

This staging step only distributes the application's native identity. Each owner must still explicitly link their own Google account. Existing Wi-Fi-only transport, storage, recording, and driving gates remain unchanged.
