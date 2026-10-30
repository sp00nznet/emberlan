# Test media

Served by the harness's fake media server so the bot checks play real audio and video. All
generated with ffmpeg from its built-in test pattern and tone (no third-party content):

```sh
SRC="-f lavfi -i testsrc2=size=320x180:rate=15:duration=4 -f lavfi -i sine=frequency=440:duration=4"
V="-c:v libx264 -profile:v baseline -pix_fmt yuv420p -b:v 150k -g 15 -c:a aac -b:a 48k -ac 1"
ffmpeg $SRC $V -movflags +faststart test.mp4
ffmpeg -f lavfi -i sine=frequency=440:duration=4 -c:a libmp3lame -b:a 48k -ac 1 test.mp3
ffmpeg $SRC $V -f mpegts test.ts
ffmpeg $SRC $V -f hls -hls_time 2 -hls_list_size 0 -hls_segment_filename hls/seg%d.ts hls/index.m3u8
```
