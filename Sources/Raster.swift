import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct PrintError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct Raster {
    static let width = 384
    static let rowBytes = width / 8
    static let maxHeight = 1600
    static let textLimit = 8_000
    static let imageLimit = 20 * 1024 * 1024

    let height: Int
    let bits: Data
    private let grayscale: Data

    init(text: String, imageURL: URL?, size: Int) throws {
        guard [18, 24, 32].contains(size) else {
            throw PrintError("Choose a text size of 18, 24, or 32.")
        }
        guard text.utf8.count <= Self.textLimit else {
            throw PrintError("This text is too long. Split it into shorter print jobs.")
        }
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || imageURL != nil else {
            throw PrintError("Enter some text or choose an image first.")
        }

        let inset = 12
        let contentWidth = Self.width - 2 * inset
        let attributed = NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica Neue" as CFString, CGFloat(size), nil),
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
        ])
        let typesetter = CTFramesetterCreateWithAttributedString(attributed)
        let measured = CTFramesetterSuggestFrameSizeWithConstraints(
            typesetter, CFRange(), nil, CGSize(width: contentWidth, height: Self.maxHeight), nil
        )
        let textHeight = text.isEmpty ? 0 : Int(ceil(measured.height)) + 4
        guard textHeight + 2 * inset <= Self.maxHeight else {
            throw PrintError("This text is too tall for one job. Split it into shorter prints.")
        }

        let image = try imageURL.map(Self.loadImage)
        let gap = image != nil && textHeight > 0 ? 14 : 0
        let remainingHeight = Self.maxHeight - 2 * inset - textHeight - gap
        if image != nil && remainingHeight < 32 {
            throw PrintError("The text leaves too little room for the image. Shorten the text or print separately.")
        }
        let (imageWidth, imageHeight) = image.map { image -> (Int, Int) in
            let scale = min(CGFloat(contentWidth) / CGFloat(image.width), CGFloat(remainingHeight) / CGFloat(image.height), 1)
            return (max(1, Int(CGFloat(image.width) * scale)), max(1, Int(CGFloat(image.height) * scale)))
        } ?? (0, 0)
        let height = 2 * inset + textHeight + gap + imageHeight
        self.height = height

        guard let canvas = CGContext(data: nil, width: Self.width, height: height,
            bitsPerComponent: 8, bytesPerRow: Self.width, space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue), let buffer = canvas.data else {
            throw PrintError("Could not create the print raster.")
        }
        canvas.setFillColor(gray: 1, alpha: 1)
        canvas.fill(CGRect(x: 0, y: 0, width: Self.width, height: height))
        if textHeight > 0 {
            let frameBounds = CGRect(x: inset, y: height - inset - textHeight, width: contentWidth, height: textHeight)
            let frame = CTFramesetterCreateFrame(typesetter, CFRange(), CGPath(rect: frameBounds, transform: nil), nil)
            let visible = CTFrameGetVisibleStringRange(frame)
            guard visible.length == attributed.length else {
                throw PrintError("This text is too tall for one job. Split it into shorter prints.")
            }
            canvas.textMatrix = .identity
            CTFrameDraw(frame, canvas)
        }
        if let image {
            canvas.interpolationQuality = .high
            canvas.draw(image, in: CGRect(x: (Self.width - imageWidth) / 2, y: inset,
                                         width: imageWidth, height: imageHeight))
        }

        let source = buffer.assumingMemoryBound(to: UInt8.self)
        var pixels = [UInt8](repeating: 255, count: Self.width * height)
        var packed = [UInt8](repeating: 0, count: Self.rowBytes * height)
        let photoTop = inset + textHeight + gap
        let photoLeft = (Self.width - imageWidth) / 2
        var errors = [Double](repeating: 0, count: Self.width + 2)
        var nextErrors = errors

        for row in 0..<height {
            let photoRow = row >= photoTop && row < photoTop + imageHeight
            for column in 0..<Self.width {
                let index = row * Self.width + column
                var shade = Double(source[index])
                if photoRow && column >= photoLeft && column < photoLeft + imageWidth {
                    shade = max(0, min(255, shade + errors[column + 1]))
                    let remainder = (shade < 128 ? shade : shade - 255) / 16
                    errors[column + 2] += remainder * 7
                    nextErrors[column] += remainder * 3
                    nextErrors[column + 1] += remainder * 5
                    nextErrors[column + 2] += remainder
                }
                if shade < 128 {
                    pixels[index] = 0
                    packed[row * Self.rowBytes + column / 8] |= 0x80 >> (column % 8)
                }
            }
            swap(&errors, &nextErrors)
            for index in nextErrors.indices { nextErrors[index] = 0 }
        }
        self.grayscale = Data(pixels)
        self.bits = Data(packed)
    }

    private static func loadImage(_ url: URL) throws -> CGImage {
        guard let properties = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
              properties.isRegularFile == true else {
            throw PrintError("Could not open the image file.")
        }
        guard (properties.fileSize ?? 0) <= imageLimit else {
            throw PrintError("Choose an image no larger than 20 MB.")
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxHeight
        ]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw PrintError("Could not read this image. Try a PNG, JPEG, or HEIC file.")
        }
        return image
    }

    func writePreview(to url: URL) throws {
        guard let provider = CGDataProvider(data: grayscale as CFData),
              let image = CGImage(width: Self.width, height: height, bitsPerComponent: 8, bitsPerPixel: 8,
                                  bytesPerRow: Self.width, space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw PrintError("Could not create the PNG preview.") }
        CGImageDestinationAddImage(output, image, nil)
        guard CGImageDestinationFinalize(output) else {
            throw PrintError("Could not save the PNG preview.")
        }
    }
}
