# "Please, Mum" claymation spot — production handoff

30–40s Oliver-parody ad: sad British clay boy, bland chicken, wailing mum,
The Flavor Doctor arrives, golden finale, brand end card. Deliberately
over-acted Aardman-style claymation.

## Current state (v2 delivered, v3 planned)

v2 cut was delivered but has known defects: lip-sync misses (faces too small
in wide shots), nonsensical cuts, phantom knocking hand. v3 plan (agreed with
Jeromy): **fewer, longer, closer shots** —

1. **Shot A (15s)** — one-take two-hander, tight framing: boy's line at 2.0s,
   mum's wail at 6.0s. Audio: `public/media/spot/track-a.mp3` (15s, dialogue
   only). Start frame: crop of clay-1 master (regenerate crop:
   `crop=1920:1080:480:180` on clay-1-master.png).
2. **Shot B (10s)** — door close-up: knocks in POST ONLY (never in the
   generation's reference audio — it grows phantom hands), door opens, Doctor
   declaims from the entryway. Audio: `public/media/spot/track-b.mp3`
   (doctor line at 3.5s). Start: crop of clay-3-preknock
   (`crop=1600:900:1100:330`), end: same crop of clay-3-doctor.
3. **Shot C (8s)** — reuse `cdn/spot/wan-shot4-finale.mp4` (dry-eyed happy
   finale, already generated + approved).
4. **End card 5s** — HyperFrames CTA frame (poster in repo history /
   `public/media/promo-home-poster.jpg` style), plus score cues below.

## Asset inventory

- **R2 (served at https://flavordoctors.com/cdn/spot/…)**: clay-1-master.png,
  clay-2-wail.png, clay-3-doctor.png, clay-3-preknock.png, clay-4-finale.png,
  wan-shot2-mum.mp4 (THE sacred salt-and-pepper mum take — audio extractable),
  wan-shot4-finale.mp4.
- **Repo**: `public/media/spot/track-a.mp3`, `track-b.mp3` (final per-shot
  dialogue beds), `cue-tragic.mp3` + `cue-triumph.mp3` (score; tragic = shots
  A/B misery, triumph starts ON the door opening), earlier track-s*.mp3
  (superseded).
- Dialogue voices: boy = ElevenLabs Emilia Bennett pitch-shifted −2 semitones
  (rubberband), Doctor = George (JBFqnCBsd6RMkjVDRZzb), mum = extracted Kling
  take (never regenerate — Jeromy loves it).

## Generation notes

- Best lip-sync path: Higgsfield MCP `wan2_7`, `start_image`/`end_image` +
  `audio_references` roles, 1080p. The MCP connector drops often; the platform
  REST API (platform.higgsfield.ai, `Authorization: Key <key>:<secret>`) has
  NO Wan/lip-sync models — only Kling 2.1/2.5-turbo/3.0 (v3 = in-model
  dialogue), DoP, Soul. API wallet is separate from app credits.
- Assembly recipe (ffmpeg): concat shots (scale 1920x1080 lanczos, fps 24),
  replace each shot's audio with its repo track (apad/atrim to clip length),
  cue-tragic 0→door-knock fade, cue-triumph adelay to the door-open moment,
  end card 5s fade-in, loudnorm I=-16, x264 crf 20. Keep deliverables <25 MB
  for inline chat preview (re-encode crf 25 if needed).

## Site cleanup once final

Remove `public/media/spot/track-*.mp3` staging files from the repo/site.
