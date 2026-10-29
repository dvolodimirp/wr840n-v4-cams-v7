#!/bin/sh
# A/B test of the stream engines on one camera.
#   sh /tmp/cams-ustest.sh /dev/video0 320x240
# Stops the "cams" service for the duration of the test (the camera can only be opened once),
# runs ustreamer (with and without --tcp-nodelay, at 30 and 15 fps) and mjpg-streamer,
# counts the JPEG frames a client receives in 10 s and starts the service again at the end.
DEV=${1:-/dev/video0}
RES=${2:-320x240}
PORT=8099
SECS=10
OUT=/tmp/cams-ustest.out

[ -c "$DEV" ] || { echo "no such device: $DEV"; exit 1; }
RESTORE=0
if [ -x /etc/init.d/cams ]; then
  /etc/init.d/cams stop >/dev/null 2>&1
  RESTORE=1
fi
killall ustreamer mjpg_streamer >/dev/null 2>&1
sleep 2

cleanup() {
  killall ustreamer mjpg_streamer >/dev/null 2>&1
  rm -f "$OUT"
  [ "$RESTORE" = 1 ] && /etc/init.d/cams start >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

# count multipart boundaries received over $SECS seconds from $1 (URL)
count_frames() {
  rm -f "$OUT"
  wget -q -O "$OUT" "$1" >/dev/null 2>&1 &
  wp=$!
  sleep "$SECS"
  kill "$wp" >/dev/null 2>&1
  wait "$wp" 2>/dev/null
  n=$(grep -ao 'boundarydonotcross' "$OUT" 2>/dev/null | wc -l)
  echo "$n"
}

run_ustreamer() { # fps nodelay
  fps=$1; nd=$2
  extra=""
  [ "$nd" = 1 ] && extra="--tcp-nodelay"
  /usr/bin/ustreamer --device "$DEV" --format YUYV --resolution "$RES" --desired-fps "$fps" \
    --encoder CPU --quality 80 --host 127.0.0.1 --port "$PORT" \
    --device-timeout 3 --no-log-colors $extra >/tmp/cams-ustest.log 2>&1 &
  up=$!
  sleep 4
  n=$(count_frames "http://127.0.0.1:$PORT/stream")
  st=$(wget -q -T 2 -O - "http://127.0.0.1:$PORT/state" 2>/dev/null)
  cap=$(printf '%s' "$st" | sed -n 's/.*"captured_fps": *\([0-9][0-9]*\).*/\1/p')
  que=$(printf '%s' "$st" | sed -n 's/.*"queued_fps": *\([0-9][0-9]*\).*/\1/p')
  kill "$up" >/dev/null 2>&1
  wait "$up" 2>/dev/null
  sleep 2
  echo "ustreamer fps=$fps nodelay=$nd: frames/${SECS}s=$n  (camera ${cap:--} fps, encoder ${que:--} fps at the end)"
}

run_mjpg() { # fps
  fps=$1
  /usr/bin/mjpg_streamer -i "input_uvc.so -d $DEV -r $RES -f $fps -y -n" \
    -o "output_http.so -p $PORT" >/tmp/cams-ustest.log 2>&1 &
  mp=$!
  sleep 4
  n=$(count_frames "http://127.0.0.1:$PORT/?action=stream")
  kill "$mp" >/dev/null 2>&1
  wait "$mp" 2>/dev/null
  sleep 2
  echo "mjpg-streamer fps=$fps: frames/${SECS}s=$n"
}

echo "device $DEV, $RES, test $SECS s each"
if [ -x /usr/bin/ustreamer ]; then
  for fps in 30 15; do
    for nd in 1 0; do
      run_ustreamer "$fps" "$nd"
    done
  done
else
  echo "ustreamer is not installed"
fi
if [ -x /usr/bin/mjpg_streamer ]; then
  for fps in 30 15; do run_mjpg "$fps"; done
fi
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)"
