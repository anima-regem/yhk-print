import Darwin
import Foundation

func die(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func printerLock() throws -> Int32 {
    let path = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("yhk-7314.lock").path
    let descriptor = open(path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw PrintError("Could not open the printer lock.") }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
        close(descriptor)
        throw PrintError("The printer is busy with another command. Try again when it finishes.")
    }
    return descriptor
}

func readStandardInput(limit: Int) throws -> Data {
    let input = FileHandle.standardInput
    var data = Data()
    while let chunk = try input.read(upToCount: min(8192, limit + 1 - data.count)), !chunk.isEmpty {
        data.append(chunk)
        if data.count > limit { throw PrintError("Input is too large for one print job.") }
    }
    return data
}

do {
    var args = Array(CommandLine.arguments.dropFirst())
    guard let command = args.first else { throw PrintError("Run ./yhk --help for usage.") }
    args.removeFirst()

    if command == "status" {
        guard args.isEmpty else { throw PrintError("Usage: ./yhk status") }
        _ = try printerLock()
        BluetoothPrinter(raster: nil).run()
    }

    // The local phone relay sends the same packed raster displayed in the browser.
    if command == "print-raster" {
        let raster = try readStandardInput(limit: Raster.maxHeight * Raster.rowBytes)
        guard args.isEmpty, !raster.isEmpty, raster.count.isMultiple(of: Raster.rowBytes) else {
            throw PrintError("Invalid print raster.")
        }
        _ = try printerLock()
        BluetoothPrinter(raster: raster).run()
    }

    guard command == "print" || command == "preview" else { throw PrintError("Run ./yhk --help for usage.") }
    var text = ""
    var image: URL?
    var preview: URL?
    var size = 24
    while !args.isEmpty {
        let flag = args.removeFirst()
        guard !args.isEmpty else { throw PrintError("Missing value for \(flag).") }
        let value = args.removeFirst()
        switch flag {
        case "--text":
            if value == "-" {
                let data = try readStandardInput(limit: Raster.textLimit)
                guard let decoded = String(data: data, encoding: .utf8) else {
                    throw PrintError("The input text must be UTF-8.")
                }
                text = decoded
            } else {
                text = value
            }
        case "--image": image = URL(fileURLWithPath: value)
        case "--size": size = Int(value) ?? 0
        case "--output" where command == "preview": preview = URL(fileURLWithPath: value)
        default: throw PrintError("Unknown option \(flag). Run ./yhk --help for usage.")
        }
    }

    let raster = try Raster(text: text, imageURL: image, size: size)
    if command == "preview" {
        guard let preview else { throw PrintError("Provide --output preview.png.") }
        try raster.writePreview(to: preview)
        print("Saved preview to \(preview.path).")
    } else {
        _ = try printerLock()
        BluetoothPrinter(raster: raster.bits).run()
    }
} catch {
    die(error.localizedDescription)
}
