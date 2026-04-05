# Mobile YouTube Desktop Controls 🎹

A browser extension that adds keyboard navigation and volume control to mobile YouTube (m.youtube.com) when accessed on desktop browsers.

## Features

- ✨ **Keyboard Navigation** - Navigate YouTube videos using your keyboard on the mobile site
- 🔊 **Volume Control** - Control video volume with keyboard shortcuts
- ⌨️ **Desktop Controls** - Brings desktop-like functionality to the mobile YouTube interface
- 🎭 **Auto-Hide Cursor & Controls** - Cursor and controls automatically hide after 1 second of inactivity (just like desktop YouTube)

## Installation

### Chrome/Edge/Brave

1. Download or clone this repository
2. Open your browser and navigate to:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the extension directory

## Usage

1. Navigate to [m.youtube.com](https://m.youtube.com) in your desktop browser
2. Open any video
3. Use keyboard shortcuts to control playback

### Auto-Hide Behavior

The extension mimics YouTube desktop's behavior:
- When the mouse is over a playing video and remains idle for 1 second, the cursor and controls automatically hide
- Moving the mouse or using keyboard shortcuts will show the cursor and controls again
- When the video is paused, the cursor and controls remain visible
- The extension's volume panel also auto-hides when idle

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `←` | Rewind 10 seconds |
| `→` | Forward 10 seconds |
| `↑` | Volume up (Safe 0-100%, Amplified 101-300%) |
| `↓` | Volume down (Safe 0-100%, Amplified 101-300%) |
| `M` | Mute/Unmute |
| `F` | Toggle fullscreen |

## Why This Extension?

The mobile YouTube site (m.youtube.com) lacks keyboard controls that are available on the desktop version. This extension bridges that gap, making it easier to control videos when accessing the mobile site from a desktop browser.

## Development

### Project Structure

```
yt-mobile-keyboard-nav/
├── manifest.json      # Extension manifest
├── content.js         # Main functionality
├── styles.css         # Custom styles
├── icon48.png         # 48x48 icon
└── icon128.png        # 128x128 icon
```

### Technologies

- **JavaScript** - Core functionality
- **CSS** - UI enhancements
- **Manifest V3** - Modern extension architecture

## Support

If you encounter any issues or have suggestions, please [open an issue](https://github.com/hihumanzone/yt-mobile-keyboard-nav/issues).

## Acknowledgments

Built to enhance the mobile YouTube experience on desktop browsers.

---

Made with ❤️ by [hihumanzone](https://github.com/hihumanzone)
