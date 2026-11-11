import CoreBluetooth
import Darwin
import Foundation

final class BluetoothPrinter: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let name = "YHK-7314"
    private static let rowHeader = Data([0x1d, 0x76, 0x30, 0, UInt8(Raster.rowBytes), 0, 1, 0])
    private let serviceID = CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455")
    private let writeID = CBUUID(string: "49535343-8841-43F4-A8D4-ECBE34729BB3")
    private let notifyID = CBUUID(string: "49535343-1E4D-4BD9-BA61-23C647249616")
    private let packets: [Data]
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var writer: CBCharacteristic?
    private var packetIndex = 0
    private var timeout: DispatchWorkItem?
    private var reply = Data()
    private var firmware = ""
    private var printing = false

    init(raster: Data?) {
        if let raster {
            var packets = [Data([0x1b, 0x40])]
            // The YHK-7314 drops rows from multi-row commands. Sending the header
            // and pixels together reduces the pause between one-row commands.
            for offset in stride(from: 0, to: raster.count, by: Raster.rowBytes) {
                var row = Self.rowHeader
                row.append(raster.subdata(in: offset..<(offset + Raster.rowBytes)))
                packets.append(row)
            }
            packets.append(Data([0x1b, 0x64, 0x05, 0x0a, 0x0a, 0x0a]))
            self.packets = packets
        } else {
            self.packets = []
        }
        super.init()
    }

    func run() -> Never {
        central = CBCentralManager(delegate: self, queue: .main)
        armTimeout(after: 24, "Could not find or connect to \(Self.name). Turn it on, keep it nearby, and disconnect other printing apps.")
        dispatchMain()
    }

    private func armTimeout(after seconds: Double, _ message: String) {
        timeout?.cancel()
        let task = DispatchWorkItem { self.fail(message) }
        timeout = task
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: task)
    }

    private func fail(_ message: String) -> Never {
        let detail = printing && packetIndex > 0 ? " Some data was sent. Check the paper before retrying." : ""
        if let peripheral { central.cancelPeripheralConnection(peripheral) }
        die(message + detail)
    }

    private func finish(_ message: String) -> Never {
        if let peripheral { central.cancelPeripheralConnection(peripheral) }
        print(message)
        exit(0)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: central.scanForPeripherals(withServices: nil)
        case .poweredOff: fail("Turn on Bluetooth in macOS System Settings.")
        case .unauthorized: fail("Allow Bluetooth access for the app or terminal in System Settings → Privacy & Security → Bluetooth.")
        case .unsupported: fail("This Mac does not support Bluetooth Low Energy.")
        default: break
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover device: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advertised = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        guard peripheral == nil, advertised == Self.name || device.name == Self.name else { return }
        peripheral = device
        central.stopScan()
        central.connect(device)
    }

    func centralManager(_ central: CBCentralManager, didConnect device: CBPeripheral) {
        device.delegate = self
        device.discoverServices([serviceID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect device: CBPeripheral, error: Error?) {
        fail("Bluetooth connection failed. \(error?.localizedDescription ?? "Turn the printer off and back on.")")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral device: CBPeripheral, error: Error?) {
        if printing && packetIndex == packets.count {
            finish("Sent all print data to \(Self.name). Check the paper.")
        }
        fail("Bluetooth disconnected from \(Self.name).")
    }

    func peripheral(_ device: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = device.services?.first(where: { $0.uuid == serviceID }) else {
            fail("The printer’s Bluetooth service is unavailable.")
        }
        device.discoverCharacteristics([writeID, notifyID], for: service)
    }

    func peripheral(_ device: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let writer = service.characteristics?.first(where: { $0.uuid == writeID && $0.properties.contains(.write) }),
              let receiver = service.characteristics?.first(where: { $0.uuid == notifyID && $0.properties.contains(.notify) }),
              device.maximumWriteValueLength(for: .withResponse) >= Self.rowHeader.count + Raster.rowBytes else {
            fail("This Bluetooth connection does not support the YHK-7314 write and status characteristics.")
        }
        self.writer = writer
        device.setNotifyValue(true, for: receiver)
    }

    func peripheral(_ device: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.isNotifying else {
            fail("Could not receive printer status over Bluetooth.")
        }
        requestStatus()
    }

    func peripheral(_ device: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        if !printing, let value = characteristic.value { reply.append(value) }
    }

    private func requestStatus() {
        armTimeout(after: 8, "The printer did not respond to status checks.")
        let queries: [[UInt8]] = [[0x1e, 0x47, 0x03], [0x10, 0x04, 0x04], [0x10, 0x04, 0x03]]
        func probe(_ index: Int) {
            if index == queries.count {
                if packets.isEmpty {
                    finish("\(Self.name) responded. Paper detected. No printer error. \(firmware)")
                }
                printing = true
                sendPacket()
                return
            }
            reply.removeAll()
            write(Data(queries[index]))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) {
                if index == 0 {
                    self.firmware = String(decoding: self.reply.prefix(while: { $0 != 0 }), as: UTF8.self)
                } else {
                    guard self.reply.count == 1, let byte = self.reply.first, byte & 0x93 == 0x12 else {
                        self.fail("The printer did not return a valid status. Check its connection and try again.")
                    }
                    if index == 1 && byte & 0x60 == 0x60 {
                        self.fail("The printer is out of paper. Load a roll and close the lid.")
                    }
                    if index == 2 && byte & 0x6c != 0 {
                        self.fail("The printer reports an error (0x\(String(byte, radix: 16))). Check the battery, lid, and paper. \(self.firmware)")
                    }
                }
                probe(index + 1)
            }
        }
        probe(0)
    }

    private func write(_ packet: Data) {
        guard let peripheral, let writer else { fail("The Bluetooth connection is not ready.") }
        peripheral.writeValue(packet, for: writer, type: .withResponse)
    }

    private func sendPacket() {
        if packetIndex == packets.count {
            timeout?.cancel()
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                self.finish("Sent all print data to \(Self.name). Check the paper.")
            }
            return
        }
        armTimeout(after: 10, "The printer stopped acknowledging Bluetooth writes.")
        write(packets[packetIndex])
    }

    func peripheral(_ device: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error { fail("Bluetooth write failed. \(error.localizedDescription)") }
        if printing {
            packetIndex += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.025) { self.sendPacket() }
        }
    }
}
