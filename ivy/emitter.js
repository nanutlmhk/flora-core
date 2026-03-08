// central place Ivy emits normalized data
// for now: just forward to in-process handler or HTTP later

function emitIvyPayload(payload) {
  // ALPHA: just emit event / callback
  // DO NOT console.log
  if (global.__IVY_SINK__) {
    global.__IVY_SINK__(payload);
  }
}

module.exports = { emitIvyPayload };
