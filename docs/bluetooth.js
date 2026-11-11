import {rowBytes} from "./raster.js";

const service = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const writer = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const receiver = "49535343-1e4d-4bd9-ba61-23c647249616";
const rowHeader = Uint8Array.of(0x1d, 0x76, 0x30, 0, rowBytes, 0, 1, 0);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class BrowserPrinter {
  constructor(disconnected) {
    this.disconnected = disconnected;
    this.device = null;
    this.writer = null;
    this.receiver = null;
    this.reply = [];
    this.collect = event => {
      const value = event.target.value;
      for (let i = 0; i < value.byteLength; i += 1) this.reply.push(value.getUint8(i));
    };
  }

  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{namePrefix: "YHK-"}],
      optionalServices: [service],
    });
    this.device = device;
    const disconnect = () => {
      if (this.device !== device) return;
      this.receiver?.removeEventListener("characteristicvaluechanged", this.collect);
      this.writer = null;
      this.receiver = null;
      this.device = null;
      this.disconnected();
    };
    device.addEventListener("gattserverdisconnected", disconnect, {once: true});
    try {
      const gatt = await device.gatt.connect();
      const uart = await gatt.getPrimaryService(service);
      this.writer = await uart.getCharacteristic(writer);
      this.receiver = await uart.getCharacteristic(receiver);
      this.receiver.addEventListener("characteristicvaluechanged", this.collect);
      await this.receiver.startNotifications();
      return device.name || "YHK printer";
    } catch (error) {
      device.removeEventListener("gattserverdisconnected", disconnect);
      if (device.gatt?.connected) device.gatt.disconnect();
      disconnect();
      throw error;
    }
  }

  disconnect() {
    this.device?.gatt.disconnect();
  }

  async write(packet) {
    const characteristic = this.writer;
    if (!characteristic) throw new Error("The printer disconnected.");
    if (typeof characteristic.writeValueWithResponse === "function" && characteristic.properties?.write !== false) {
      await characteristic.writeValueWithResponse(packet);
    } else if (typeof characteristic.writeValue === "function") {
      await characteristic.writeValue(packet);
    } else if (typeof characteristic.writeValueWithoutResponse === "function") {
      await characteristic.writeValueWithoutResponse(packet);
    } else {
      throw new Error("This browser cannot write to the printer over Bluetooth.");
    }
  }

  async query(code) {
    this.reply = [];
    await this.write(Uint8Array.of(0x10, 0x04, code));
    await wait(850);
    const [status] = this.reply;
    if (this.reply.length !== 1 || (status & 0x93) !== 0x12) {
      throw new Error("The printer did not return its status. Reconnect it and try again.");
    }
    return status;
  }

  async print(raster, progress) {
    if (((await this.query(4)) & 0x60) === 0x60) {
      throw new Error("The printer is out of paper. Load a roll and close the lid.");
    }
    const status = await this.query(3);
    if (status & 0x6c) {
      throw new Error(`Printer error 0x${status.toString(16)}. Check the battery, lid, and paper.`);
    }

    let started = false;
    try {
      await this.write(Uint8Array.of(0x1b, 0x40));
      started = true;
      await wait(25);
      const combineRowWrites = this.device?.name === "YHK-7314";
      const rowPacket = new Uint8Array(rowHeader.length + rowBytes);
      rowPacket.set(rowHeader);
      for (let offset = 0; offset < raster.length; offset += rowBytes) {
        const row = raster.subarray(offset, offset + rowBytes);
        if (combineRowWrites) {
          rowPacket.set(row, rowHeader.length);
          await this.write(rowPacket);
        } else {
          await this.write(rowHeader);
          await wait(25);
          await this.write(row);
        }
        await wait(25);
        if (offset % (rowBytes * 8) === 0) progress(offset / raster.length);
      }
      await this.write(Uint8Array.of(0x1b, 0x64, 0x05, 0x0a, 0x0a, 0x0a));
      progress(1);
      await wait(3000);
    } catch (error) {
      if (!started) throw error;
      throw new Error(`${error.message} Some data was sent. Check the paper before retrying.`);
    }
  }
}
