const { SerialPort } = require("serialport");
const EventEmitter = require("events");
const { unescapePacket, computeChecksum } = require("./framing");

const FLAG = 0x7e;

// Set GES5_DEBUG_RAW=1  to dump every raw byte received/sent (hex)
const DEBUG_RAW    = String(process.env.GES5_DEBUG_RAW    || "0") === "1";
// Hardware flow control is disabled by default because the typical B650 connection
// chain (B650 USB → ATEN UC-232A → DB9 cable → USB-Serial adapter → PC) breaks
// CTS/RTS end-to-end.  Set GES5_RTSCTS=1 to re-enable if your setup supports it.
const NO_RTSCTS    = String(process.env.GES5_RTSCTS       || "0") !== "1";

class GES5Serial extends EventEmitter {
  constructor(options) {
    super();
    this.path = options.path;
    this.baudRate = options.baudRate || 19200;
    this.parity = options.parity || "even";
    this.port = null;
    this.buffer = Buffer.alloc(0);
  }

  open() {
    const useRtsCts = !NO_RTSCTS;
    console.log(`[GES5] opening ${this.path} ${this.baudRate} 8${this.parity[0].toUpperCase()}1 rtscts=${useRtsCts}`);

    this.port = new SerialPort({
      path: this.path,
      baudRate: this.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: this.parity,
      rtscts: useRtsCts, // Spec requires CTS/RTS; set GES5_NO_RTSCTS=1 to disable for testing
      autoOpen: false,
    });

    this.port.on("open", () => {
      // Assert RTS + DTR so the device knows a master is connected.
      // NOTE: with rtscts:true the OS manages RTS for flow control, so this
      // call may have no effect on some platforms/adapters — that is OK.
      this.port.set({ rts: true, dtr: true }, (err) => {
        if (err) console.warn("[GES5] set RTS/DTR warn:", err.message);
        else console.log("[GES5] RTS + DTR asserted");
      });
      this.emit("open");
    });

    this.port.on("data", (data) => {
      if (DEBUG_RAW) {
        console.log(`[GES5] RAW RX ${data.length}B: ${data.toString("hex")}`);
      }
      this.emit("_raw_activity"); // notify index.js to reset silence timer
      this.buffer = Buffer.concat([this.buffer, data]);
      this.processBuffer();
    });

    this.port.on("error", (err) => this.emit("error", err));
    this.port.on("close", () => this.emit("close"));

    this.port.open((err) => {
      if (err) this.emit("error", err);
    });
  }

  write(data) {
    if (!this.port || !this.port.isOpen) {
      console.warn("[GES5] write called but port not open");
      return;
    }
    if (DEBUG_RAW) {
      console.log(`[GES5] RAW TX ${data.length}B: ${data.toString("hex")}`);
    }
    this.port.write(data, (err) => {
      if (err) console.error("[GES5] write error:", err.message);
    });
    // Flush the OS TX buffer so bytes go out immediately, not batched.
    this.port.drain((err) => {
      if (err) console.warn("[GES5] drain warn:", err.message);
      else if (DEBUG_RAW) console.log("[GES5] TX drained");
    });
  }

  close() {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
  }

  processBuffer() {
    while (true) {
      const startIdx = this.buffer.indexOf(FLAG);
      if (startIdx === -1) {
        // No flag at all — discard everything (noise)
        if (this.buffer.length > 0) {
          if (DEBUG_RAW) {
            console.log(`[GES5] discarding ${this.buffer.length}B pre-flag noise`);
          }
          this.buffer = Buffer.alloc(0);
        }
        break;
      }

      // Discard bytes before the first flag
      if (startIdx > 0) {
        if (DEBUG_RAW) {
          console.log(`[GES5] discarding ${startIdx}B before start flag`);
        }
        this.buffer = this.buffer.slice(startIdx);
      }

      // Look for the end flag (the next 0x7E after the start flag)
      const endIdx = this.buffer.indexOf(FLAG, 1);
      if (endIdx === -1) {
        // End flag not received yet — wait for more data
        break;
      }

      // Extract frame content between the two flags
      const frame = this.buffer.slice(1, endIdx);
      // Advance buffer past the end flag (it becomes the start of the next frame)
      this.buffer = this.buffer.slice(endIdx);

      if (frame.length === 0) {
        // Two consecutive flags — keep the second as potential start flag
        continue;
      }

      try {
        const unescaped = unescapePacket(frame);

        if (unescaped.length < 2) {
          console.warn("[GES5] packet too short after unescape:", unescaped.toString("hex"));
          continue;
        }

        // Last byte = checksum; the Datex record is everything before it
        const data  = unescaped.slice(0, -1);
        const rxChk = unescaped[unescaped.length - 1];
        const calcChk = computeChecksum(data);

        if (rxChk !== calcChk) {
          console.warn(`[GES5] checksum FAIL rx=0x${rxChk.toString(16)} calc=0x${calcChk.toString(16)} len=${data.length}`);
          continue;
        }

        if (DEBUG_RAW) {
          console.log(`[GES5] packet OK ${data.length}B chk=0x${rxChk.toString(16)}`);
        }
        this.emit("packet", data);
      } catch (err) {
        console.error("[GES5] unescape/parse error:", err.message);
      }
    }
  }
}

module.exports = GES5Serial;
