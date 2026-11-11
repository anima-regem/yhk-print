# YHK Print

Print text, pictures, or both on the YHK-7314 Bluetooth thermal printer. The web app previews the same black-and-white bitmap it sends to the printer.

**[Open YHK Print](https://anima-regem.github.io/yhk-print/)**

## Print from your phone

- **Android.** Open the web app in Chrome, tap **Connect printer**, and choose **YHK-7314**. Chrome’s **Install app** option adds it to your home screen. After the first visit, the app can load offline.
- **iPhone with direct Bluetooth.** Open the same web address inside [Bluefy](https://apps.apple.com/app/id1492822055), allow Bluetooth access, and tap **Connect printer**. Keep the app open during printing.
- **iPhone with Safari.** Run `./yhk web --share` on your Mac and open the address it prints on your iPhone. Both devices must use the same Wi-Fi. The Mac sends the slip to the printer over Bluetooth. Leave the Mac awake and the command running. The address includes a pairing key that works until you stop the relay. If Safari asks for local network access, allow it.

The GitHub Pages site also opens in Safari, but direct Bluetooth requires a browser with Web Bluetooth support.

## Print from your Mac

Install the Apple command line tools once with `xcode-select --install` if `xcrun --find swiftc` cannot locate the Swift compiler.

```sh
git clone https://github.com/anima-regem/yhk-print.git
cd yhk-print
./yhk print --text 'Hello from my Mac!'
./yhk print --text - < message.txt
./yhk print --text 'A photo for the fridge' --image ~/Pictures/photo.jpg
./yhk preview --text 'A larger heading' --size 32 --output preview.png
./yhk status
```

The launcher builds the native command on first use. Allow Bluetooth in macOS if prompted. Text sizes are 18, 24, or 32 printer dots. Use `./yhk web` for a local web interface that works in Safari and other browsers. The local server requires Python 3.9+ and has no third-party packages. You can also use the GitHub Pages app in Chrome on your Mac.

Load paper, turn on the printer, and disconnect it from other printing apps before connecting. If it reports a printer error, charge it and check the lid and paper. The printer acknowledges data transfers, so check the paper to confirm the result.

## Development

`Sources/` contains the native Mac rasterizer and CoreBluetooth transport. `docs/` is a static, dependency-free PWA published from the main branch. To serve just the static app, run `python3 -m http.server 7314 --bind 127.0.0.1 --directory docs`. Bump the cache version in `docs/sw.js` when updating cached assets.

The hosted app processes text and pictures on-device. The optional Mac relay transfers the rendered bitmap over your Wi-Fi. Use it on a network you trust and stop it with Control-C when finished.

Protocol references include the [YHK Mini Printer BLE notes](https://github.com/joshmcarthur/yhk-mini-printer/blob/main/docs/protocol.md) and [BLEThermalPrinterYHK](https://github.com/fun6400/BLEThermalPrinterYHK). The project uses the [MIT license](LICENSE). The bundled Instrument Sans font uses its own [SIL Open Font License](docs/OFL-Instrument-Sans.txt).
