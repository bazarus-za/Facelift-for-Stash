# 🎭 Facelift for Stash

Facelift is a premium, feature-rich dashboard and player extension for [Stash](https://github.com/stashapp/stash). It completely revamps the Stash landing page with a modern, glassmorphic UI, fluid CSS micro-animations, immersive media players, and deep analytics.

---

## 🚀 Key Features

### 1. ⏳ History Time Machine
* **Dynamic Time Travel**: Instantly warp to specific points in your viewing history. Choose from pre-configured ranges like *On This Day (1 Year Ago)*, *Today*, *Last 7/30/90/365 Days*, or specify a *Custom Range*.
* **Aggregated Metrics**: Displays total viewing hours/minutes, session counts, and unique scenes viewed for the selected date range.
* **Inline Scene Player**: Stream and interact with historical scenes directly from the slider carousel.

### 2. ⏱️ Dynamic Watch Time Deduplication (Wall-Clock Accurate)
* **No Multi-Tab Skewing**: If you open and watch multiple scenes simultaneously in separate tabs, Facelift's dynamic interval-merging algorithm ensures your watch time stats are never inflated.
* **Interval Merging**: Groups overlap intervals into a consolidated timeline, reporting true real-world wall-clock viewing time.
* **Retroactive Integration**: Deduplication works retroactively across the **History Time Machine**, **Daily Trends** calendar, and all dashboard widgets.

### 3. 🌀 Stash Shorts (TikTok/Shorts Feed)
* **Intuitive Navigation**: Swipe vertically (touch) on mobile, use your mouse scroll wheel, or use keyboard arrows (`Up`/`Down`) to flip through random scene preview shorts.
* **Rebuilt Native Controls Overlay**:
  * Hidden standard browser controls (`controls: false`).
  * Full-width custom yellow timeline progress scrubber (`#ffa500`) supporting pointer captures for dragging and scrubbing.
  * Backdrop-blurred glassmorphic control bar featuring Play/Pause, Next/Prev buttons, Mute/Volume toggles, Favorite Heart toggles, Loop, Playback Speed multiplier (toggle between `1x`, `1.25x`, `1.5x`, and `2x`), and Fullscreen.
  * Direct "Open Full Scene" launcher that resumes the video exactly where you left off in the Short player.
* **Automated Playback History**: If a scene preview is active for more than 1 minute (60 seconds) in the shorts feed, it is automatically tracked and logged to your Stash play history.

### 📊 4. Daily Trends Dashboard
* **Dynamic Calendar Heatmap**: View a calendar interface with activity intensity dots showing your daily usage frequency.
* **Performers & Tags Breakdown**: Click on any date to see which performers and tags you watched the most, along with total plays and deduplicated watch time.
* **Scene List**: Scroll through a detailed list of every scene played on the selected date.

### 🖼️ 5. Random Image Spotlight & Collage Canvas
* **Spotlight Gallery**: Displays a beautiful grid of random images from your Stash collection. Click any photo to open the lightbox.
* **Interactive Lightbox**: Swipe, pan, drag, and zoom in on photos with fluid mouse/touch pointer events.
* **Collage Canvas (Desktop Only)**: Select multiple images from the spotlight gallery and open them in a floating interactive canvas. Drag, resize, and layer photos to create custom dynamic collages.

### 🎲 6. Quick Launcher Row
* **Surprise Me**: Streams a random scene that you have previously watched.
* **Unwatched Gem**: Selects and plays a random, completely unwatched scene from your library.
* **Random Warp**: Automatically picks a random historical date and loads its Time Machine viewing logs.

---

## 📱 Mobile Optimizations

Facelift is designed to feel like a native mobile app on iOS and Android devices (tailored for premium displays like the iPhone 17 Pro Max):
* **Aspect Ratio Preservation**: Scene previews inside the Shorts feed are contained cleanly (`object-fit: contain`) without cropping, ensuring videos display in their native format.
* **Dynamic Height Scaling**: Built with short viewport units (`100svh`) to keep the player fully visible and prevent layout overflow or awkward page scrolling.
* **Touch-Friendly Layout**: Re-aligned title/performer labels to clear the bottom control bar. Standardized carousel spacing, touch offsets, and disabled desktop-only features (like image checkboxes and the Collage Canvas) for clean mobile usability.

---

## 🛠️ Tech Stack & Architecture

* **Frontend**: React (rendered dynamically into Stash's UI container), vanilla Javascript (ES6+), and vanilla CSS (incorporating CSS variables, HSL color palettes, and glassmorphic designs).
* **API Integration**: Performs GraphQL queries and mutations against Stash's local backend schema for fetching scenes, images, performers, and updating play counts (`sceneAddPlay`).
* **State Management**: Uses React hooks (`useState`, `useMemo`, `useRef`, `useEffect`) to orchestrate video elements, mouse/touch drag scrubbers, and active play session accumulation.

---

## 📥 Installation & Setup

1. Locate your Stash installation plugins folder (usually `<Stash Directory>/plugins/`).
2. Clone or download this repository into a new folder named `facelift` inside the plugins folder:
   ```bash
   cd <Stash Directory>/plugins/
   git clone https://github.com/yourusername/facelift.git
   ```
3. Your plugins folder layout should look like this:
   ```text
   plugins/
   └── facelift/
       ├── facelift.yml
       ├── script.js
       └── style.css
   ```
4. Reload your plugins. You can do this by going to **Settings > Plugins > Reload Plugins** in your Stash dashboard, or by executing this GraphQL mutation:
   ```graphql
   mutation {
     reloadPlugins
   }
   ```
5. Open Stash. You will be greeted by the brand new Facelift landing page!

---

## ⌨️ Keyboard Shortcuts (Desktop)

While viewing the **Stash Shorts** feed, you can control playback with the following hotkeys:
* `Spacebar`: Play / Pause toggle.
* `Arrow Down`: Next Short.
* `Arrow Up`: Previous Short.
* `M` / `m`: Mute / Unmute toggle.
* `Enter` / `F` / `f`: Open the active scene in a new tab.

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
