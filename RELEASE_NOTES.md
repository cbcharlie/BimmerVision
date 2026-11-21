# BimmerVision 0.2.78 — Remote Backup and horn protection

BimmerVision now includes **Remote Backup through Google Drive**, with automatic Wi-Fi uploads from the car and selected uploads from your phone. View your saved BimmerVision Google Drive recordings at [BimmerVision.app](https://bimmervision.app/).

- **Protect a moment with the horn:** automatically locks the complete clips covering 30 seconds before and after a honk, even across clip boundaries. With Google Drive connected and Auto Upload enabled, protected clips can also back up automatically. The locked-only option includes horn-protected clips.
- **Manage recordings in iDrive:** browse the newest drives first and lock important drives. Remote Backup shows the queue, per-drive progress, time remaining, recent completions and storage errors.
- **Choose your upload conditions:** the car uploads only over Wi-Fi, including phone hotspots, and never uses vehicle cellular. Uploads are allowed at any speed unless “Do not backup while driving” is checked. “Pause Recording During Remote Backup” pauses recording only while stationary during eligible backup work.
- **Manage backups from your phone:** add recordings or whole drives, remove queued items and view status/history. While the phone player is connected, car-side cloud work pauses. Phone uploads use the phone browser and its own internet, with explicit confirmation before cellular use. A persistent upload screen shows progress, recordings remaining and estimated completion; successful completion returns to the car player.
- **Updated players:** clearer mobile recording rows, direct “Back up current recording” actions, an accessible More menu, immediate Google sign-in feedback and reliable timeline transitions. Playback continues to download each recording fully before opening it.

## Before you back up

Back up **important clips first**, especially unless your car has a strong Wi-Fi signal. A typical two-minute clip is about **300 MB**; size varies. Vehicles commonly sleep about **5–15 minutes after locking**, depending on the vehicle and conditions, so large uploads may not finish before sleep.

Incomplete car backups resume automatically when the car is awake and eligible Wi-Fi returns. Verified completed files are kept; a partially uploaded phone file may restart when the car takes over. Keep the original car tab connected and the phone upload window open during phone uploads.

You are responsible for your Google account and Google Drive storage limits. Full remote storage pauses backup. BimmerVision’s Drive viewer shows files created by or explicitly authorized for BimmerVision. Local website uploads require confirmation that your device is on Wi-Fi.

**Privacy:** recordings and recording metadata go directly from your car/device to your own Google Drive. They are never uploaded to BimmerVision servers, and BimmerVision developers cannot see them. Browsers process recordings and metadata locally for playback.

Install **app and recorder 0.2.78 together** through MGU Store. Existing recording preferences are preserved. Recorded-drive timestamps use explicitly labeled UTC unless a local display timezone is configured.

Validation: 482 car tests and 285 website tests pass. Homepage layouts were checked at 320, 390 and 1280 pixels. The preceding 0.2.77 build’s phone upload, progress and return flow was confirmed on the test vehicle; the additional fresh-account setup fix and release provisioning were checked locally. This publication does not install 0.2.78 on the test vehicle.
# BimmerVision 0.2.79 — Internal recording storage

BimmerVision can now record to either a writable USB drive or the MGU's persistent internal data partition. When no USB drive is connected, the internal store is selected automatically when available.

- **Choose an internal storage limit:** set a 1–10 GB cap in **About**; new installs start at 4 GB.
- **Keep recording as the cap fills:** the recorder removes the oldest eligible unlocked recordings as it needs room. Locked clips, horn-protected clips, active clips and clips required for playback remain protected. If protected recordings fill the cap, the recorder stops and reports that internal storage is full.
- **Manage both destinations:** the Recording storage screen shows internal storage alongside connected USB drives. Playback, locking, phone transfer and Remote Backup use the same recording library.

Install **app and recorder 0.2.79 together** through MGU Store. Internal recording storage uses a dedicated folder under `/var/opt/bimmervision-recorder` and is limited to the configured cap.

Validation: package generation and static source checks only; no real-car recording session has been performed for this feature.

# BimmerVision 0.2.78 — Remote Backup and horn protection
