#!/usr/bin/env bash
# Generate the media fixtures the tests need. Nothing binary lives in the repo.
# Needs ffmpeg and ImageMagick (convert). Run once: bash tests/make_fixtures.sh
set -e
OUT="$(cd "$(dirname "$0")" && pwd)/fixtures/generated"
mkdir -p "$OUT" && cd "$OUT" && rm -f ./*
q(){ "$@" >/dev/null 2>&1; }
q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=3 -f lavfi -i "sine=frequency=1000:duration=3" -filter:a "volume=-6dB" -c:v libvpx -b:v 300k -c:a libvorbis -t 3 UK_LIZ_Basking_16x9_3.webm
q ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=25:duration=3 -c:v libvpx -b:v 300k -t 3 UK_LIZ_WrongSize_16x9_3.webm
q ffmpeg -y -f lavfi -i color=c=black:s=640x360:r=25:d=1 -c:v libvpx -b:v 300k -t 1 _b.webm
q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libvpx -b:v 300k -t 2 _m.webm
printf "file '_b.webm'\nfile '_m.webm'\n" > _l.txt && q ffmpeg -y -f concat -safe 0 -i _l.txt -c copy UK_LIZ_BlackHead_16x9_3.webm && rm -f _b.webm _m.webm _l.txt
q ffmpeg -y -f lavfi -i color=c=0x707070:s=640x360:r=25:d=3 -c:v libvpx -b:v 300k -t 3 grey_ok.webm
q ffmpeg -y -f lavfi -i "sine=frequency=1000:duration=3" -filter:a "volume=-6dB" -c:a pcm_s16le -ar 48000 -ac 2 ref.wav
q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p -t 2 good.mp4
q ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p -t 2 big.mp4
# one file per ProRes flavour, to check each is told apart
for prof in 0:proxy 1:lt 2:standard 3:hq 4:4444 5:4444xq; do
  n=${prof#*:}; p=${prof%%:*}; pix=yuv422p10le; [ $p -ge 4 ] && pix=yuva444p10le
  q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=1 -c:v prores_ks -profile:v $p -pix_fmt $pix -t 1 prores_$n.mov
done
convert -size 2480x3508 xc:white -strip A4_nodensity.png
head -c 50000 /dev/urandom > garbage.mp4 && cp garbage.mp4 garbage.wav
: > empty.mp4; : > empty.wav; : > empty.srt; : > empty.xml
printf 'this is not xml at all' > junk.xml
printf 'no timecodes here\njust words\n' > notsrt.srt
python3 -c "open('bom.srt','wb').write('\ufeff1\r\n00:00:01,000 --> 00:00:03,000\r\nI didn\'t know\r\nthat was you.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSingle line here.\r\n\r\n3\r\n00:00:07,000 --> 00:00:09,000\r\nTwo lines\r\nagain here.\r\n'.encode('utf-8'))"
# ── audio sync: irregular bursts, so there's exactly one right alignment
BURSTS="0.3*sin(2*PI*440*t)*(between(t,0.5,0.9)+between(t,1.6,1.8)+between(t,2.9,3.6)+between(t,4.4,4.5)+between(t,5.5,6.3)+between(t,7.0,7.2))"
q ffmpeg -y -f lavfi -i "aevalsrc='$BURSTS|$BURSTS':s=48000:d=8" -c:a pcm_s16le sync_ref.wav
q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=8 -i sync_ref.wav -map 0:v -map 1:a -c:v libvpx -b:v 200k -c:a libvorbis -t 8 sync_ok.webm
q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=8 -i sync_ref.wav -map 0:v -map 1:a -af "adelay=400|400" -c:v libvpx -b:v 200k -c:a libvorbis -t 8 sync_late.webm
# ── loudness: test signals, and QuickTime masters in every PCM layout, with
#    ffmpeg's own readings written alongside for the meter to be checked against
q ffmpeg -y -f lavfi -i "sine=frequency=1000:duration=12:sample_rate=48000" -af "volume=-20dB" -ac 2 -c:a pcm_s16le loud_tone.wav
# a sine whose samples never land on its crest: true peak is exactly -6.02 dBTP
q ffmpeg -y -f lavfi -i "aevalsrc='0.5*sin(2*PI*12000*t+PI/4)|0.5*sin(2*PI*12000*t+PI/4)':s=48000:d=6" -c:a pcm_f32le loud_isp.wav
q ffmpeg -y -f lavfi -i "anoisesrc=color=pink:duration=40:sample_rate=48000:amplitude=0.4" -af "volume='if(lt(t,10),0.05,if(lt(t,20),0.6,if(lt(t,30),0.2,0.9)))':eval=frame" -ac 2 -c:a pcm_s24le loud_steps.wav
V="-f lavfi -i color=c=gray:s=64x36:r=25:d=40"
for a in pcm_s16le pcm_s16be pcm_s24le pcm_s24be pcm_s32le pcm_f32le; do
  q ffmpeg -y $V -i loud_steps.wav -map 0:v -map 1:a -c:v prores_ks -profile:v 3 -c:a $a -shortest loud_$a.mov
done
q ffmpeg -y $V -i loud_steps.wav -filter_complex "[1:a]channelsplit=channel_layout=stereo[L][R]" -map 0:v -map "[L]" -map "[R]" -c:v prores_ks -profile:v 3 -c:a pcm_s24le -shortest loud_monopair.mov
q ffmpeg -y $V -i loud_steps.wav -filter_complex "[1:a]pan=7.1|c0=c0|c1=c1|c2=0.3*c0|c3=0.3*c1|c4=0.3*c0|c5=0.3*c1|c6=0.3*c0|c7=0.3*c1[a]" -map 0:v -map "[a]" -c:v prores_ks -profile:v 3 -c:a pcm_s24le -shortest loud_8ch.mov
q ffmpeg -y $V -i loud_steps.wav -filter_complex "[1:a]pan=5.1|c0=c0|c1=c1|c2=0.5*c0+0.5*c1|c3=0.2*c0|c4=0.4*c0|c5=0.4*c1[a]" -map 0:v -map "[a]" -c:v prores_ks -profile:v 3 -c:a pcm_s24le -shortest loud_51.mov
# a ProRes master to deliver: picture, timecode-free, 24-bit PCM stereo
q ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=25:duration=6 -f lavfi -i "anoisesrc=color=pink:duration=6:sample_rate=48000:amplitude=0.25" -map 0:v -map 1:a -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -c:a pcm_s24le -ac 2 UK_LIZ_Master_16x9_6.mov
q ffmpeg -y -i loud_steps.wav -c:a pcm_s24be loud_steps.aiff
q ffmpeg -y -i loud_steps.wav -c:a pcm_s16le -rf64 always loud_steps_rf64.wav
q ffmpeg -y -i loud_steps.wav -c:a pcm_s24le -ar 44100 loud_steps_44k.wav
# 40 seconds with only four level changes, 150ms late: a long, coarse file
# catches the envelope drifting between sample rates, which short ones don't
q ffmpeg -y -f lavfi -i testsrc=size=320x180:rate=25:duration=40 -i loud_steps.wav -map 0:v -map 1:a -c:v libvpx -b:v 100k -c:a libvorbis -af "adelay=150|150" -t 40 sync_steps_late150.webm
ref(){ ffmpeg -nostats -hide_banner -i "$1" -filter_complex "$2" -f null - 2>&1 | awk '/Summary/{s=1} s&&/I:/{i=$2} s&&/LRA:/{l=$2} s&&/Peak:/{p=$2} END{print i, l, p}'; }
: > loud_ref.txt
for f in loud_tone.wav loud_isp.wav loud_steps.wav loud_steps.aiff loud_steps_rf64.wav loud_steps_44k.wav loud_pcm_*.mov UK_LIZ_Master_16x9_6.mov; do echo "$f $(ref $f '[0:a:0]ebur128=peak=true')" >> loud_ref.txt; done
echo "loud_monopair.mov $(ref loud_monopair.mov '[0:a:0][0:a:1]amerge=inputs=2,ebur128=peak=true')" >> loud_ref.txt
echo "loud_8ch.mov $(ref loud_8ch.mov '[0:a:0]pan=stereo|c0=c0|c1=c1,ebur128=peak=true')" >> loud_ref.txt
echo "loud_51.mov $(ref loud_51.mov '[0:a:0]aformat=channel_layouts=5.1,ebur128=peak=true')" >> loud_ref.txt
echo "fixtures ready in $OUT ($(ls | wc -l) files)"
