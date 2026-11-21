import Foundation
import ImageIO
import Vision

func jsonEscape(_ value: String) -> String {
    var out = ""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 32 {
                out += String(format: "\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    return out
}

func imageSizeAndSource(_ path: String) -> (CGImageSource, Int, Int)? {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = props[kCGImagePropertyPixelWidth] as? Int,
          let height = props[kCGImagePropertyPixelHeight] as? Int else {
        return nil
    }
    return (source, width, height)
}

var imageJson: [String] = []
let paths = Array(CommandLine.arguments.dropFirst())

for path in paths {
    guard let (source, width, height) = imageSizeAndSource(path),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        continue
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.008
    request.recognitionLanguages = ["en-US", "zh-Hans", "zh-Hant"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        continue
    }

    var boxes: [String] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else {
            continue
        }
        let confidence = candidate.confidence
        if confidence < 0.28 {
            continue
        }
        let bb = observation.boundingBox
        let x = max(0.0, bb.origin.x * Double(width))
        let y = max(0.0, (1.0 - bb.origin.y - bb.height) * Double(height))
        let w = min(Double(width) - x, bb.width * Double(width))
        let h = min(Double(height) - y, bb.height * Double(height))
        if w < Double(width) * 0.04 || h < Double(height) * 0.01 {
            continue
        }
        boxes.append("{\"text\":\"\(jsonEscape(candidate.string))\",\"confidence\":\(String(format: "%.3f", confidence)),\"x\":\(Int(x.rounded())),\"y\":\(Int(y.rounded())),\"w\":\(Int(w.rounded())),\"h\":\(Int(h.rounded()))}")
    }

    imageJson.append("{\"file\":\"\(jsonEscape(path))\",\"width\":\(width),\"height\":\(height),\"boxes\":[\(boxes.joined(separator: ","))]}")
}

print("[\(imageJson.joined(separator: ","))]")
