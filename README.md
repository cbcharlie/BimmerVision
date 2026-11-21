<p align="center">
  <img src="docs/images/bimmervision-readme.png" alt="BimmerVision" width="600">
</p>

# BimmerVision

**Your BMW's 360° cameras. Now a continuous dashcam.**

BimmerVision brings continuous, multi-camera dashcam recording to compatible BMW vehicles running **iDrive 7 (MGU)**.

Unlike BMW's factory Drive Recorder, which saves short clips, BimmerVision continuously captures footage from your vehicle's 360° Surround View camera system and saves it to a **USB flash drive or capped internal storage**.

Record your drives automatically, review all four cameras simultaneously, and export footage with detailed vehicle telemetry—all from your phone or computer.

**[Website](https://BimmerVision.App)** · **[Latest Release](https://github.com/Hexphase/BimmerVision/releases/latest)**

---

## See playback and exports

<table>
<tr>
<td width="30%" valign="top">
<a href="docs/images/playback-mobile.png"><img src="docs/images/playback-mobile.png" alt="Full-length mobile BimmerVision playback screen with four cameras, telemetry, timeline, camera selector, driving view and GPS map" width="240"></a>
<p><sub>Full mobile playback screen. Select either image to see it at its original size.</sub></p>
</td>
<td width="70%" valign="top">
<h3>Your whole drive, in one place</h3>
<p>Watch the front, rear, left and right cameras together, then choose an individual camera from the top-down vehicle selector. On mobile, the video and compact instrument bar stay pinned while you scroll through the drive timeline, camera controls, Driving view and map.</p>
<ul>
<li><strong>Follow the recording:</strong> scrub the timeline across clips, tap the video to play or pause, or double-tap either edge to skip ten seconds.</li>
<li><strong>Read the instruments:</strong> speed, detected speed limit, turn signals, steering, brake and accelerator activity stay synchronized with the footage.</li>
<li><strong>See the driving context:</strong> the metadata-based 3D view shows the blue driver vehicle, supported traffic detections, lead distance in feet, lane information and recognized road signs.</li>
<li><strong>Review the route:</strong> recorded GPS positions connect the video to its location on the map. Available details depend on the metadata captured by the car.</li>
</ul>
<p><strong>Powered by your BMW’s KAFAS camera data:</strong> Driving View is generated from the built-in KAFAS camera perception data captured in the metadata alongside your recordings, combined with recorded vehicle telemetry and GPS.</p>
<p>The same playback design is available in the car-hosted player and BimmerVision Web. Local recordings and metadata are processed in your browser; they are not uploaded to BimmerVision.</p>
<h3>Export the footage and its context</h3>
<p>The example below is a frame from an exported video: all four camera views, the GPS map, Driving view and synchronized instrument overlays, including speed, speed limit, blinkers, steering and pedal activity. Choose the cameras and overlays you want when exporting.</p>
<a href="docs/images/exported-video-metadata.png"><img src="docs/images/exported-video-metadata.png" alt="Exported BimmerVision video showing four camera views, GPS map, 3D driving visualization, lead distance, speed limit and instrument overlays" width="640"></a>
<p><sub>Exported video with camera footage and recorded vehicle metadata.</sub></p>
</td>
</tr>
</table>

## Current release

**0.2.79** adds selectable internal recording storage with a 1–10 GB limit, automatic cleanup of the oldest unlocked clips, and retains Google Drive Remote Backup and horn protection. View your BimmerVision Google Drive backups at [BimmerVision.app](https://bimmervision.app/). Install the app and required recorder together. See [release notes](RELEASE_NOTES.md).

## Features

### Continuous 360° Recording

Turn your BMW's existing cameras into a full-time, four-channel dashcam.

- **Four-camera recording:** Capture front, rear, left, and right camera views.
- **Continuous recording:** Automatically capture your drives without manually starting a new recording.
- **USB or internal storage:** Choose a connected USB drive or the MGU's internal `/var/opt` data partition.
- **Capped internal storage:** Set an internal recording limit from 1 to 10 GB. The default is 4 GB.
- **Automatic storage management:** When internal storage reaches its limit, BimmerVision removes the oldest unlocked recordings to keep recording. Locked and horn-protected clips remain protected; recording pauses if protected clips alone fill the cap.
- **Protected recordings:** Lock important clips to prevent automatic deletion.
- **Persistent recording:** Enable recording once, and BimmerVision remembers your preference for future drives.
- **Manual control:** Pause and resume recording whenever needed.

A recording indicator in iDrive lets you know when recording is active.

![Blinking BimmerVision recording indicator in iDrive](docs/images/recording-indicator.gif)

### Remote Backup and horn protection

Connect your Google account in **Remote Backup**, then enable **Auto Upload on Wi-Fi** for automatic backups. Choose all eligible recordings or only locked drives and horn-protected clips. You can also select individual recordings or entire drives from the phone player’s **Remote Backup** manager.

- Pressing the horn automatically protects the complete clips covering the 30 seconds before and after the honk, including adjacent clips when needed. Automatic backup of these protected clips requires Google Drive setup and Auto Upload to be enabled.
- The car uploads **only over Wi-Fi**, including a phone hotspot. BimmerVision never uses the car’s cellular connection. Backups can run at any speed unless **Do not backup while driving** is checked; pausing recording is a separate option and applies only while stationary.
- While your phone is connected to the car player, car-side cloud work pauses. Select **Back up current recording** or use **Remote Backup** to upload selected recordings with your phone browser and its own internet connection. Phone cellular use requires your confirmation. Keep the car tab connected and the upload window open; completion returns you to the car player.
- At [BimmerVision.app](https://bimmervision.app/), connect Google Drive to view recordings created by or explicitly authorized for BimmerVision. You can also back up local recordings after confirming the device is on Wi-Fi.

**Choose important clips first.** Unless your car has a strong Wi-Fi signal, large queues may take several sessions. A typical two-minute clip is about **300 MB**, depending on the recording. Vehicles commonly sleep around **5–15 minutes after locking**, with timing varying by vehicle and conditions. Unfinished car backups automatically resume when the car is awake and eligible Wi-Fi returns. Verified completed files are retained; an unfinished phone-uploaded file may restart when the car takes over.

Recordings and recording metadata travel directly between your device/car and your own Google Drive. They are never uploaded to BimmerVision servers, and BimmerVision developers cannot view them. You are responsible for your Google account and Drive storage limits; a full Drive pauses backup. Original USB recordings are retained after backup; normal unlocked-recording retention still applies.

### How Camera Recording Works

BimmerVision normally records all four Surround View cameras simultaneously.

However, BMW's built-in camera functions can temporarily change the video stream available to BimmerVision.

| Vehicle activity | Recorded footage |
|---|---|
| Normal driving | All four camera views |
| Reversing / Parking Assistant | Active BMW parking camera view |
| Front Wide View activated | Front wide-angle camera |
| Return to normal driving | Four-camera recording resumes |

In normal driving conditions, all four cameras are recorded. When a factory BMW camera function takes control of the camera stream, BimmerVision records the available camera view instead.

**Important:** Third-party camera applications that modify or take control of the camera stream may interfere with BimmerVision. Running other camera applications simultaneously is not recommended, as this can prevent all four views from being recorded.

### Vehicle Telemetry

BimmerVision does more than record video. It also captures supported vehicle information alongside your recordings, allowing you to reconstruct what happened during a drive.

Supported telemetry includes:

- **Vehicle speed** — Current driving speed
- **Speed limit detection** — Detected posted speed limit
- **Turn signals** — Left and right blinker activation
- **Steering angle** — Steering wheel position
- **Braking** — Brake pedal activation
- **Acceleration** — Accelerator pedal activation
- **Horn** — Horn activation
- **GPS location** — Geographic position throughout the drive
- **Date and time** — Recording timestamps
- **Forward vehicle detection** — Vehicles detected ahead and their estimated distance
- **Lane detection** — Detected road lanes and lane positioning

Telemetry availability depends on the vehicle's hardware, configuration, and accessible data signals. Not every BMW exposes every data point.

### Playback & Video Export

Review your recordings using BimmerVision's player on your phone or computer.

**Multi-camera playback**

- View all four cameras in a synchronized grid.
- Switch between individual camera views.
- Navigate recordings using an interactive timeline.
- Review footage alongside available vehicle telemetry.
- Follow your recorded route on a GPS map.

**Customizable exports**

Choose how much information appears in your exported video.

Export options include camera selection, multi-camera layouts, timestamps, driving telemetry, and supported visual overlays.

You can create anything from a clean camera-only video to a detailed driving visualization featuring speed, steering, turn signals, GPS route information, detected lanes, and surrounding vehicles where supported.

Your footage, your choice.

---

## Compatibility & Requirements

BimmerVision requires:

- A compatible **BMW equipped with the 360° Surround View camera system**.
- **iDrive 7 with an MGU head unit**.
- **MGU Store** installed on the head unit.
- A writable USB flash drive connected to a supported vehicle USB port, or sufficient space on the MGU's persistent internal data partition.

**A standard rear-view camera alone is not sufficient.** BimmerVision requires the multi-camera Surround View system.

**iDrive 8 and newer systems have not been tested.** These systems may handle camera access differently and should not be assumed compatible.

Compatibility and telemetry availability may vary between BMW models and configurations.

### Is a BMW Drive Recorder Subscription Required?

BimmerVision is designed to capture the camera stream independently of BMW's official Drive Recorder recording service.

Starting with version **0.2.10**, BimmerVision requests the camera stream directly rather than relying on the official Drive Recorder recording function.

Testing has confirmed recording works with the factory Drive Recorder feature disabled.

However, the test vehicle still has an active Drive Recorder entitlement. Recording on a vehicle that has never had a Drive Recorder subscription **has not yet been physically verified**.

A factory Drive Recorder subscription is therefore not currently a confirmed requirement, but subscription-free operation cannot yet be guaranteed for every compatible vehicle.

---

## Installation

BimmerVision is installed directly through **MGU Store**.

1. Open MGU Store on your BMW.
2. Add **`Hexphase/BimmerVision`** as a source.
3. Find **BimmerVision** and select **Install**.
4. The required recorder companion installs automatically. No additional companion installation is necessary.
5. If prompted to restart iDrive to finish setup, park the vehicle and use MGU Store's restart option.

### Start Recording

1. Connect a writable USB flash drive, or use the internal storage option.
2. Open **BimmerVision** in iDrive.
3. Select **Enable recording**.

That's it.

BimmerVision remembers your recording preference, so you won't need to launch the application and manually start recording every time you drive.

Recording automatically resumes on subsequent drives when the required cameras and selected recording storage are available. If no USB drive is connected and internal storage is available, BimmerVision can use the internal store.

You can pause recording at any time using the app.

---

## Watch Recordings on Your Phone

BimmerVision includes a browser-based player accessible directly from your phone.

No separate mobile application is required.

It can use your BMW's existing Wi-Fi connection, including the wireless connection used by CarPlay or Android Auto where supported, without requiring you to enable a separate phone hotspot.

### Connect Your Phone

1. Open **Connect Phone** in BimmerVision on your vehicle's iDrive screen.
2. Connect your phone to your BMW's Wi-Fi network.
3. Scan the QR code displayed on the vehicle's screen.
4. Open the BimmerVision player in your phone's browser.

Keep the **Connect Phone** page open in iDrive while accessing recordings.

![BimmerVision Connect Phone interface](docs/images/connect-phone.png)

### Review & Manage Recordings

From your phone, you can:

- Browse recorded drives and individual clips.
- Watch synchronized multi-camera footage.
- Switch between camera perspectives.
- Navigate recordings using the playback timeline.
- Review GPS routes and available driving information.
- View drive duration and average speed.
- Lock important recordings to prevent deletion.
- Delete recordings you no longer need.
- Download and export footage.

**Playback behavior:** Each recording downloads completely before playback begins. Loading time depends on its size and the connection speed.

Clips currently being recorded appear in the library once recording of that clip has finished.

### Playback During Active Recording

BimmerVision prioritizes recording performance over playback and downloads.

When the vehicle is actively recording, file transfers may run more slowly to reduce USB storage contention and avoid interrupting footage capture.

For the best playback and download performance, **pause recording before reviewing or transferring large files**.

---

## Watch Recordings on Your Computer

BimmerVision recordings can also be reviewed directly from the USB drive.

1. Safely remove the USB drive from your BMW.
2. Connect it to your Windows PC or Mac.
3. Visit **[BimmerVision.App](https://BimmerVision.App)**.
4. Open your BimmerVision recordings.
5. Review, manage, or export your footage.

The computer player supports reviewing synchronized camera footage and associated vehicle information.

You can also access the [BimmerVision Web Player on GitHub Pages](https://hexphase.github.io/BimmerVision-Web/).

---

## Recording Storage Management

BimmerVision can record to a USB flash drive or to a capped folder on the MGU's persistent `/var/opt` data partition.

Open **Recording storage** in the iDrive application to view:

- Connected USB storage information
- Used and available storage space
- Total recording count
- Number of protected recordings
- Recording and storage management controls
- For internal storage, the configured limit and available space

![BimmerVision recording storage management](docs/images/usb-storage.png)

### Automatic Recording Cleanup

When internal storage reaches its configured limit, BimmerVision automatically removes the oldest **unlocked** recordings to make room for new footage. USB storage continues to use its available capacity.

**Locked recordings are never deleted by automatic cleanup.**

This allows continuous recording without requiring you to manually clear internal storage after every drive, provided enough unlocked footage can be removed.

### Protecting Important Recordings

Recordings can be locked through the connected phone player.

Locked recordings are protected from automatic storage cleanup and the app's bulk erase operation.

To delete unlocked footage, select **Erase all unlocked recordings** in the recording storage menu and confirm the action.

Removing or updating BimmerVision does not erase existing recordings stored on USB or internal storage.

### Safely Removing Your USB Drive

To prevent corruption or incomplete recordings:

1. Pause recording.
2. Open **USB storage**.
3. Wait for the **Safe to Remove** status.
4. Disconnect the USB drive.

Avoid disconnecting storage while recording is active.

---

## Important Limitations

### Camera Stream Availability

BimmerVision records the camera stream made available by the vehicle.

If BMW's factory reversing, parking, or camera preview functions change the active camera stream, the recording may temporarily switch away from the normal four-camera view.

Other third-party applications that access or manipulate the same camera stream may also cause interruptions or unexpected recording behavior.

For reliable four-camera recording, avoid running competing camera applications.

### Vehicle Data Availability

Vehicle telemetry depends on the signals available from each BMW model and configuration.

Features such as lane detection, surrounding vehicle visualization, detected speed limits, and GPS overlays require corresponding vehicle data.

Unavailable values will not be fabricated.

### Recording & Playback Performance

Camera capture and recording take priority over viewing, downloads, and exports.

Playback and transfers may be intentionally slower while recording is active to reduce the risk of dropped frames or interrupted recording.

---

## Diagnostics & Troubleshooting

Starting with **BimmerVision 0.2.36**, diagnostic logs are written to the connected USB drive while recording is enabled.

Logs are stored in:

`BimmerVision-Logs/`

This folder is located alongside the main `BimmerVision` recordings directory.

Diagnostic information includes recording health, failures, and CPU utilization.

For privacy, diagnostic logs do not include raw location telemetry or phone-pairing credentials.

BimmerVision automatically rotates app-owned logs with a combined storage limit of **64 MiB**.

Diagnostic logs are preserved when recordings are erased.

### Reporting an Issue

If you encounter a recording problem, please include:

1. Your BMW model and model year.
2. Your iDrive and BimmerVision versions.
3. A description of the issue and what was happening when it occurred.
4. The approximate date and time of the incident.
5. A ZIP archive of your `BimmerVision-Logs` folder, if available.

Report problems through [GitHub Issues](https://github.com/Hexphase/BimmerVision/issues).

---

## Updates

BimmerVision and its required recorder companion are updated together through MGU Store.

For rollback, retain the previous versions of both packages and reinstall them together.

Existing recordings on your USB drive are preserved through application updates and removal.

---

## Disclaimer

BimmerVision is an independent project and is not affiliated with, endorsed by, or supported by BMW AG.

This software interacts with vehicle camera systems and is intended for compatible hardware. Behavior may vary depending on vehicle configuration and software versions.

Always prioritize safe driving. Do not interact with recording controls, playback, or video displays while driving.

---

**BimmerVision — Every camera. Every drive.**
