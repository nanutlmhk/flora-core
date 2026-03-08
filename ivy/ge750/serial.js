const { SerialPort } = require("serialport");
const EventEmitter = require("events");
const CFG = require("./config");

class GESerial extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rx = Buffer.alloc(0);
    this.config = {
      path: options.path || CFG.PORT,
      baudRate: options.baudRate || CFG.BAUD_RATE,
      dataBits: options.dataBits || CFG.DATA_BITS,
      stopBits: options.stopBits || CFG.STOP_BITS,
      parity: options.parity || CFG.PARITY,
    };

    this.port = new SerialPort({
      path: this.config.path,
      baudRate: this.config.baudRate,
      dataBits: this.config.dataBits,
      stopBits: this.config.stopBits,
      parity: this.config.parity,
      rtscts: false, // SAME AS C#
      autoOpen: false,
    });

    this.port.on("data", (d) => this._onData(d));
    this.port.on("error", (e) => this.emit("error", e));
    this.port.on("close", () => this.emit("close"));
  }

  open() {
    this.port.open((err) => {
      if (err) return this.emit("error", err);
      this.emit("open");
    });
  }

  write(buf) {
    if (!this.port || !this.port.isOpen) return;
    this.port.write(buf);
  }

  setSignals(options, cb) {
    if (!this.port || !this.port.isOpen) return;
    this.port.set(options, cb);
  }

  close() {
    if (!this.port || !this.port.isOpen) return;
    this.port.close();
  }

  getPath() {
    return this.config.path;
  }

  _onData(chunk) {
    this.rx = Buffer.concat([this.rx, chunk]);

    while (true) {
      const s = this.rx.indexOf(CFG.RESP_START);
      const e = this.rx.indexOf(CFG.RESP_END, s + 1);
      if (s === -1 || e === -1) break;

      const line = this.rx.slice(s + 1, e);
      this.rx = this.rx.slice(e + 1);

      this.emit("line", line);
    }
  }
}

module.exports = GESerial;
