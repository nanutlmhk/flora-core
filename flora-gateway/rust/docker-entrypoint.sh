#!/bin/sh
# FLORA_SERIAL_BRIDGES="ttyV0:7430 ttyV1:7431" creates a virtual serial port per
# entry, bridged to a TCP listener, so simulators can act as RS-232 devices.
set -e
for bridge in ${FLORA_SERIAL_BRIDGES:-}; do
  name=${bridge%%:*}
  port=${bridge##*:}
  # One device connection at a time; the pty is recreated when the device reconnects.
  ( while true; do socat pty,link=/dev/$name,raw,echo=0,mode=666 tcp-listen:$port,reuseaddr; sleep 1; done ) &
done
[ -n "${FLORA_SERIAL_BRIDGES:-}" ] && sleep 1
exec "$@"
