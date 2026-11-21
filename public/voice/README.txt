Recorded voice lines for Deliver It.

One file per line: <id>.ogg (Opus in Ogg, mono, 48 kHz, about 32 kb/s), where <id> is the line's id in
VOICE_SCRIPT.csv at the top of the repository. Customers' lines are recorded in two voices:
<id>.a.ogg (a woman) and <id>.b.ogg (a man). Record them dry: the game adds the radio and phone sound.

    ffmpeg -i take.wav -ac 1 -c:a libopus -b:a 32k -application voip public/voice/manju.hello.1.ogg

After adding or removing files, run `node scripts/voice_files.mjs`: it rewrites manifest.json (the
list the game reads) and the "recorded" column of VOICE_SCRIPT.csv.

A line with no file here is not spoken; its words are shown on the phone instead.

The recordings here were made with Sarvam AI's Bulbul text-to-speech (model bulbul:v3) by
scripts/voice_generate.mjs, from the lines as written, read as Indian English. They are AI voices,
not recordings of people: RJ Manju is the speaker "kavya", Ravi "rahul", customers "priya" (.a) and
"amit" (.b), the security guard "ratan", the dark store's staff "neha". To make one again after its
line changes: node scripts/voice_generate.mjs --only <id> --force, then node scripts/voice_files.mjs.
