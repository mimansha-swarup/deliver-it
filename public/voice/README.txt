Recorded voice lines for Deliver It.

One file per line: <id>.ogg (Opus in Ogg, mono, 48 kHz, about 32 kb/s), where <id> is the line's id in
VOICE_SCRIPT.csv at the top of the repository. Customers' lines are recorded in two voices:
<id>.a.ogg (a woman) and <id>.b.ogg (a man). Record them dry: the game adds the radio and phone sound.

    ffmpeg -i take.wav -ac 1 -c:a libopus -b:a 32k -application voip public/voice/manju.hello.1.ogg

After adding or removing files, run `node scripts/voice_files.mjs`: it rewrites manifest.json (the
list the game reads) and the "recorded" column of VOICE_SCRIPT.csv.

A line with no file here is not spoken; its words are shown on the phone instead.
