import { useRef, useState } from 'react';

/**
 * Click-to-play promo player. Ships as a poster + play pill; the MP4 only
 * loads when the visitor asks for it (no autoplay bandwidth, sound intact).
 */
export function PromoVideo({ src, poster, title }: { src: string; poster: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    setPlaying(true);
    // Defer so the controls attribute lands before playback begins.
    requestAnimationFrame(() => ref.current?.play().catch(() => {}));
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-navy-lighter bg-navy-light shadow-2xl">
      <video
        ref={ref}
        className="aspect-video w-full"
        poster={poster}
        preload="none"
        controls={playing}
        playsInline
        onEnded={() => setPlaying(false)}
        aria-label={title}
      >
        <source src={src} type="video/mp4" />
      </video>
      {!playing && (
        <button
          className="absolute inset-0 flex items-center justify-center bg-navy/30 transition-colors hover:bg-navy/10"
          onClick={start}
          aria-label={`Play: ${title}`}
        >
          <span className="flex items-center gap-3 rounded-full bg-rx px-6 py-3 text-lg font-black text-navy shadow-xl">
            ▶ {title}
          </span>
        </button>
      )}
    </div>
  );
}
