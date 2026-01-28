# Mobile YouTube Desktop Controls 🎹

A browser extension that adds keyboard navigation and volume control to mobile YouTube (m.youtube.com) when accessed on desktop browsers.

## Features

✨ **Keyboard Navigation** - Navigate YouTube videos using your keyboard on the mobile site
🔊 **Volume Control** - Control video volume with keyboard shortcuts
⌨️ **Desktop Controls** - Brings desktop-like functionality to the mobile YouTube interface

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

### Firefox

1. Download or clone this repository
2. Navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file from the extension directory

## Usage

1. Navigate to [m.youtube.com](https://m.youtube.com) in your desktop browser
2. Open any video
3. Use keyboard shortcuts to control playback

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `←` | Rewind 5 seconds |
| `→` | Forward 5 seconds |
| `↑` | Volume up |
| `↓` | Volume down |
| `M` | Mute/Unmute |
| `F` | Toggle fullscreen |
| `K` | Play/Pause (alternative) |

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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Support

If you encounter any issues or have suggestions, please [open an issue](https://github.com/hihumanzone/yt-mobile-keyboard-nav/issues).

## Acknowledgments

Built to enhance the mobile YouTube experience on desktop browsers.

---

Made with ❤️ by [hihumanzone](https://github.com/hihumanzone)