module.exports = {
  // Serial port for standalone testing (node index.js)
  PORT: process.env.GES5_PORT || "COM8",

  // S/5 Spec: 19200, 8, Even, 1
  BAUD_RATE: 19200,
  DATA_BITS: 8,
  STOP_BITS: 1,
  PARITY: "even",
  RTSCTS: true, // Spec requires hardware handshaking
  
  // Default interval to request data (seconds).
  // Spec minimum for DRI_PH_DISPL auto-transmission is 5 s.
  TRANSMISSION_INTERVAL: 5,
  
  // Magic numbers from Spec (verified against Appendix A hex examples)
  // DRI_MT_PHDB = 0: confirmed by PHDB example where byte 15 = 0x00
  // DRI_MT_WAVE = 1: confirmed by WAVE example where byte 15 = 0x01
  DRI_MT_PHDB: 0,        // Main type: Physiological Data Bank  (r_maintype at byte 15)
  DRI_MT_WAVE: 1,        // Main type: Waveform
  DRI_PH_DISPL: 1,       // Record type: Displayed Values
  DRI_PH_10S_TREND: 2,   // Record type: 10s Trends
  DRI_PH_60S_TREND: 3,   // Record type: 60s Trends
};
