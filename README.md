# YHK Print

Print text, pictures, or both on the YHK-7314 Bluetooth thermal printer. The web app previews the same black-and-white bitmap it sends to the printer.

**[Open YHK Print](https://anima-regem.github.io/yhk-print/)**

## Print from your phone

- **Android.** Open the web app in Chrome, tap **Connect printer**, and choose **YHK-7314**. Chrome’s **Install app** option adds it to your home screen. After the first visit, the app can load offline.
- **iPhone with direct Bluetooth.** Open the same web address inside [Bluefy](https://apps.apple.com/app/id1492822055), allow Bluetooth access, and tap **Connect printer**. Keep the app open during printing.
- **Firefox or Safari on your phone.** Use the [Mac relay](#mac-relay) to print from the browser over Wi-Fi.

## Edit a slip in the browser

Choose a typeface, size, and alignment for text. Add a photo using the file picker, drag and drop, or paste. Rotate the image or adjust its scale, brightness, and print style. Download PNG saves the black-and-white preview.

The app saves your draft and the last five jobs it sent in this browser. Open Recent prints to send a job again without replacing your current draft.

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

The launcher builds the native command on first use. Allow Bluetooth in macOS if prompted. Text sizes are 18, 24, or 32 printer dots. Use the GitHub Pages app in Chrome on your Mac for direct Bluetooth, or use the Mac relay to print from Firefox or Safari.

Load paper, turn on the printer, and disconnect it from other printing apps before connecting. If it reports a printer error, charge it and check the lid and paper. The printer acknowledges data transfers, so check the paper to confirm the result.

## Mac relay

Firefox and Safari do not expose Web Bluetooth. The relay serves the same print app and sends jobs to the YHK-7314 through your Mac’s Bluetooth. It requires Python 3.9 or later.

- **Firefox or Safari on your Mac.** Run `./yhk web --no-open` from the project folder, then open <http://127.0.0.1:7314/> in your browser.
- **Firefox or Safari on your phone.** Run `./yhk web --share --no-open` and open the full address shown in the Mac terminal, including the pairing key. Connect the phone and Mac to the same Wi-Fi. If the browser asks for local network access, allow it.

Tap **Connect printer**, compose your slip, and select **Print slip**. Leave the Mac awake and the relay running while you print.

## Development

`Sources/` contains the native Mac rasterizer and CoreBluetooth transport. `docs/` is a static, dependency-free PWA published from the main branch. To serve just the static app, run `python3 -m http.server 7314 --bind 127.0.0.1 --directory docs`. Bump the cache version in `docs/sw.js` when updating cached assets.

The hosted app processes text and pictures on-device. The optional Mac relay transfers the rendered bitmap over your Wi-Fi. Use it on a network you trust and stop it with Control-C when finished.

Protocol references include the [YHK Mini Printer BLE notes](https://github.com/joshmcarthur/yhk-mini-printer/blob/main/docs/protocol.md) and [BLEThermalPrinterYHK](https://github.com/fun6400/BLEThermalPrinterYHK). The project uses the [MIT license](LICENSE). The bundled [Instrument Sans](docs/OFL-Instrument-Sans.txt) and [Bricolage Grotesque](docs/OFL-Bricolage-Grotesque.txt) fonts use the SIL Open Font License.
