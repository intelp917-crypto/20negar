import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  PictureInPicture,
  Check,
  Loader2,
  AlertCircle,
  RotateCcw as ReloadIcon,
} from 'lucide-react';
import { api } from '../api/client.ts';

interface VideoPlayerProps {
  videoId: number;
  title: string;
  posterUrl?: string;
  autoPlay?: boolean;
}

/** نرمال‌سازی مسیرها برای مقایسه (video.src همیشه مطلق است، نه نسبی) */
const toAbsoluteUrl = (url: string): string => {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
};

/** آیا منبع فعلی ویدیو همین آدرس است؟ (بدون این مقایسه، پلیر در حلقه بی‌نهایت ۴۰۴ می‌پیچد) */
const isCurrentSource = (video: HTMLVideoElement, url: string): boolean => {
  const target = toAbsoluteUrl(url);
  return video.src === target || video.currentSrc === target;
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  title,
  posterUrl,
  autoPlay = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState<boolean>(false);
  const lastFullscreenToggleRef = useRef<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const playbackStartedRef = useRef(false);
  const sourceErrorsRef = useRef<{ url: string; count: number }>({ url: '', count: 0 });

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const hasSetupRef = useRef(false);
  const inViewRef = useRef(true);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /** اگر منبع پخش تا مهلت مقرر آماده نشد، به MP4 مستقیم سوییچ کن (یا خطا نشان بده) */
  const armWatchdog = useCallback(
    (seconds = 15) => {
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.readyState >= 3) return; // در حال پخش است
        setHasError(true);
        setErrorMessage('پخش ویدیو بیش از حد طول کشید؛ اتصال اینترنت خود را بررسی کنید.');
        setIsBuffering(false);
      }, seconds * 1000);
    },
    [clearWatchdog]
  );

  const fallbackToDirectMp4 = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const savedTime = video.currentTime;
    const wasPlaying = !video.paused && !video.ended;
    const mp4Url = api.getStreamUrl(videoId);

    setHasError(false);
    setErrorMessage(null);
    setIsBuffering(true);

    if (!isCurrentSource(video, mp4Url)) {
      const restorePlayback = () => {
        if (savedTime > 0 && isFinite(savedTime)) {
          try {
            video.currentTime = savedTime;
          } catch {
            // ignore
          }
        }
        if (wasPlaying) video.play().catch(() => {});
        video.removeEventListener('loadedmetadata', restorePlayback);
      };
      video.addEventListener('loadedmetadata', restorePlayback);
      video.src = mp4Url;
      video.load();
      video.play().catch(() => {});
    } else {
      video.play().catch(() => {});
    }
    armWatchdog(20);
  }, [videoId, armWatchdog]);
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const setupSource = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const isFirstSetup = !hasSetupRef.current;
    hasSetupRef.current = true;

    const savedCurrentTime = video.currentTime;
    const wasPlaying = !video.paused && !video.ended;

    setHasError(false);
    setErrorMessage(null);
    setIsBuffering(true);
    clearWatchdog();
    const streamUrl = api.getStreamUrl(videoId);
    if (!isCurrentSource(video, streamUrl)) {
      video.src = streamUrl;
      video.load();
    }
    if (savedCurrentTime > 0 && isFinite(savedCurrentTime)) {
      const restoreTime = () => {
        try { video.currentTime = savedCurrentTime; } catch { /* metadata not ready */ }
        video.removeEventListener('loadedmetadata', restoreTime);
      };
      video.addEventListener('loadedmetadata', restoreTime);
    }
    if (wasPlaying || (isFirstSetup && autoPlay)) video.play().catch(() => {});
    armWatchdog(20);
  }, [videoId, autoPlay, clearWatchdog, armWatchdog]);

  useEffect(() => {
    setupSource();
    return () => {
      clearWatchdog();
    };
  }, [setupSource, clearWatchdog]);

  // فقط وقتی پلیر در دید بیننده است کلیدهای میان‌بر را جواب بده تا صفحه را قفل نکند
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        inViewRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Reset transient playback state when the video changes.
  useEffect(() => {
    playbackStartedRef.current = false;
    sourceErrorsRef.current = { url: '', count: 0 };
  }, [videoId]);

  const handleVideoError = () => {
    const video = videoRef.current;
    if (!video) return;

    // شمارش خطاها برای هر آدرس تا از حلقه بی‌نهایت تلاش مجدد جلوگیری شود
    const failedUrl = video.currentSrc || video.src || '';
    const stats = sourceErrorsRef.current;
    if (stats.url === failedUrl) {
      stats.count += 1;
    } else {
      stats.url = failedUrl;
      stats.count = 1;
    }

    const target = api.getStreamUrl(videoId);
    const alreadyDirect = isCurrentSource(video, target);

    if (!alreadyDirect && stats.count < 2) {
      console.warn('[VideoPlayer] Video element reported error. Falling back to direct MP4 stream...');
      fallbackToDirectMp4();
      return;
    }

    // همین منبع قبلاً هم خطا داده → دیگر تکرار نکن و پیام خطا نشان بده
    console.warn('[VideoPlayer] Direct stream failed as well — showing error state.');
    setHasError(true);
    setErrorMessage('فایل ویدیو موقتا در دسترس نیست یا در حال پردازش اولیه است.');
    setIsBuffering(false);
  };

  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (!showSpeedMenu) {
          setControlsVisible(false);
        }
      }, 3000);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const target = parseFloat(e.target.value);
    video.currentTime = target;
    setCurrentTime(target);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
      if (volume === 0) {
        setVolume(0.5);
        videoRef.current.volume = 0.5;
      }
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      e.stopPropagation();
    }

    const now = Date.now();
    if (now - lastFullscreenToggleRef.current < 400) {
      return;
    }
    lastFullscreenToggleRef.current = now;

    const container = containerRef.current;
    const video = videoRef.current;
    if (!container && !video) return;

    if (isPseudoFullscreen) {
      setIsPseudoFullscreen(false);
      setIsFullscreen(false);
      return;
    }

    const doc = document as any;
    const isDocFs = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    if (isDocFs || isFullscreen) {
      try {
        if (doc.exitFullscreen) {
          doc.exitFullscreen().catch(() => {});
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          doc.msExitFullscreen();
        }
      } catch (err) {
        console.warn('Exit fullscreen error:', err);
      }
      setIsFullscreen(false);
      setIsPseudoFullscreen(false);
      return;
    }

    // Detect iOS devices (iPhone, iPad, iPod)
    const isIOS = typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );

    // On iOS Safari, standard container.requestFullscreen is not supported on div elements;
    // video.webkitEnterFullscreen is the native Apple method.
    if (isIOS && video && typeof (video as any).webkitEnterFullscreen === 'function') {
      try {
        (video as any).webkitEnterFullscreen();
        setIsFullscreen(true);
        return;
      } catch (err) {
        console.warn('iOS webkitEnterFullscreen failed, trying container fallback:', err);
      }
    }

    // Standard Fullscreen API on container
    if (container?.requestFullscreen) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((_err) => {
        // If container fails (permissions, iframe policy, Android WebView), fallback to video element
        if (video?.requestFullscreen) {
          video.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {
            setIsPseudoFullscreen(true);
            setIsFullscreen(true);
          });
        } else if (video && typeof (video as any).webkitRequestFullscreen === 'function') {
          try {
            (video as any).webkitRequestFullscreen();
            setIsFullscreen(true);
          } catch {
            setIsPseudoFullscreen(true);
            setIsFullscreen(true);
          }
        } else if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
          try {
            (video as any).webkitEnterFullscreen();
            setIsFullscreen(true);
          } catch {
            setIsPseudoFullscreen(true);
            setIsFullscreen(true);
          }
        } else {
          setIsPseudoFullscreen(true);
          setIsFullscreen(true);
        }
      });
      return;
    }

    // Vendor prefixed methods on container
    if (container && (container as any).webkitRequestFullscreen) {
      try {
        (container as any).webkitRequestFullscreen();
        setIsFullscreen(true);
        return;
      } catch {
        // continue to video fallback
      }
    }

    // Direct video element requestFullscreen
    if (video?.requestFullscreen) {
      video.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {
        setIsPseudoFullscreen(true);
        setIsFullscreen(true);
      });
      return;
    }

    if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
      try {
        (video as any).webkitEnterFullscreen();
        setIsFullscreen(true);
        return;
      } catch {
        // continue to pseudo fallback
      }
    }

    // Universal pseudo-fullscreen fallback for all devices where API is blocked
    setIsPseudoFullscreen(true);
    setIsFullscreen(true);
  };

  const togglePictureInPicture = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PIP not supported:', err);
    }
  };

  const handleSpeedSelect = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
  };

  const skipTime = (amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + amount));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!inViewRef.current) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipTime(5);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skipTime(-5);
      } else if (e.key === 'Escape') {
        if (isPseudoFullscreen) {
          setIsPseudoFullscreen(false);
          setIsFullscreen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, duration, isPseudoFullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      const doc = document as any;
      const isFs = !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      );
      setIsFullscreen(isFs);
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);

    const video = videoRef.current;
    const onWebkitBegin = () => setIsFullscreen(true);
    const onWebkitEnd = () => setIsFullscreen(false);
    if (video) {
      video.addEventListener('webkitbeginfullscreen', onWebkitBegin);
      video.addEventListener('webkitendfullscreen', onWebkitEnd);
    }

    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('mozfullscreenchange', onFsChange);
      if (video) {
        video.removeEventListener('webkitbeginfullscreen', onWebkitBegin);
        video.removeEventListener('webkitendfullscreen', onWebkitEnd);
      }
    };
  }, []);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
    if (videoRef.current.buffered.length > 0) {
      setBufferedEnd(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
    }
  };

  const handleWaiting = (): void => {
    setIsBuffering(true);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
       onMouseLeave={() => isPlaying && !showSpeedMenu && setControlsVisible(false)}
      className={`w-full aspect-video bg-zinc-950 overflow-hidden shadow-2xl group select-none flex items-center justify-center transition-all ${
        isPseudoFullscreen
          ? 'fixed inset-0 z-[99999] w-screen h-screen rounded-none bg-black border-none'
          : 'relative rounded-3xl border border-zinc-800'
      }`}
      dir="ltr"
    >
       <video
         ref={videoRef}
         preload="metadata"
         controlsList="nodownload"
        poster={posterUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) setDuration(videoRef.current.duration);
          setIsBuffering(false);
        }}
        onCanPlay={() => {
          setIsBuffering(false);
          clearWatchdog();
        }}
        onWaiting={handleWaiting}
        onPlaying={() => {
          playbackStartedRef.current = true;
          setIsBuffering(false);
          clearWatchdog();
        }}
        onError={handleVideoError}
        onPlay={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onPause={() => setIsPlaying(false)}
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
      />

      {/* Buffering Spinner */}
      {isBuffering && !hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs pointer-events-none z-20">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-2" />
          <span className="text-xs text-zinc-300 font-medium">در حال بارگذاری استریم ویدیو...</span>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 p-4 text-center z-30" dir="rtl">
          <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
          <h4 className="text-sm font-bold text-zinc-100">خطا در بارگذاری ویدیو</h4>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm">{errorMessage}</p>
          <button
             onClick={() => fallbackToDirectMp4()}
            className="mt-3 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
          >
            <ReloadIcon className="w-3.5 h-3.5" />
            <span>تلاش مجدد برای پخش مستقیم</span>
          </button>
        </div>
      )}

      {/* Big Play Button Overlay when paused */}
      {!isPlaying && !isBuffering && !hasError && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-xs cursor-pointer transition-opacity z-10"
        >
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-purple-600/90 hover:bg-purple-500 text-white flex items-center justify-center shadow-2xl hover:scale-105 transition-transform">
            <Play className="w-8 h-8 md:w-10 md:h-10 ml-1 fill-white" />
          </div>
        </div>
      )}

      {/* Top Bar with Title */}
      <div
        className={`absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 pointer-events-none z-20 ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center justify-between" dir="rtl">
          <h3 className="text-white text-xs sm:text-sm md:text-base font-bold truncate drop-shadow-md pr-1">
            {title}
          </h3>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-2.5 sm:p-4 bg-gradient-to-t from-black/95 via-black/80 to-transparent transition-opacity duration-300 z-20 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Slider */}
        <div className="relative group/timeline mb-2.5 flex items-center cursor-pointer">
          <div className="absolute inset-y-1 left-0 right-0 bg-zinc-700/60 rounded-full overflow-hidden h-1.5 group-hover/timeline:h-2 transition-all">
            <div
              className="h-full bg-zinc-500/50 rounded-full"
              style={{ width: `${duration > 0 ? (bufferedEnd / duration) * 100 : 0}%` }}
            />
          </div>
          <div className="absolute inset-y-1 left-0 right-0 pointer-events-none h-1.5 group-hover/timeline:h-2 transition-all">
            <div
              className="h-full bg-purple-500 rounded-full relative"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md scale-0 group-hover/timeline:scale-100 transition-transform" />
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2 opacity-0 cursor-pointer z-10"
          />
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between text-white text-xs sm:text-sm">
          {/* Left Controls (Playback, Seek, Volume, Timestamps) */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              onClick={togglePlay}
              className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10"
              title={isPlaying ? 'توقف (Space)' : 'پخش (Space)'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
            </button>

            <button
              onClick={() => skipTime(-5)}
              className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10 text-zinc-300 hidden sm:block"
              title="۵ ثانیه قبل"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => skipTime(5)}
              className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10 text-zinc-300 hidden sm:block"
              title="۵ ثانیه بعد"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 group/volume">
              <button
                onClick={toggleMute}
                className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10"
                title={isMuted ? 'صدا روشن' : 'بی‌صدا'}
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-12 sm:w-16 md:w-20 h-1 accent-purple-500 cursor-pointer hidden xs:block"
              />
            </div>

            <div className="text-[10px] sm:text-xs font-mono text-zinc-300 ml-1">
              <span>{formatTime(currentTime)}</span>
              <span className="text-zinc-500 mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Controls: Speed, PIP, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2 relative">
            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                }}
                className="px-2 py-1 rounded-xl text-[11px] sm:text-xs font-mono font-bold bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
                title="سرعت پخش"
              >
                {playbackSpeed}x
              </button>

              {showSpeedMenu && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-36 bg-zinc-950/95 backdrop-blur-md border border-zinc-700 rounded-2xl shadow-2xl p-2 z-50 text-xs"
                  dir="rtl"
                >
                  <div className="px-2 py-1 text-zinc-400 font-bold text-[10px] border-b border-zinc-800 mb-1">
                    سرعت پخش
                  </div>
                  {speedOptions.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSpeedSelect(s)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-zinc-800 rounded-lg text-right ${
                        playbackSpeed === s ? 'text-purple-400 font-bold bg-purple-500/10' : 'text-zinc-300'
                      }`}
                    >
                      <span>{s === 1 ? 'عادی (۱x)' : `${s}x`}</span>
                      {playbackSpeed === s && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <button
                onClick={togglePictureInPicture}
                className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10 hidden sm:block"
                title="تصویر در تصویر"
              >
                <PictureInPicture className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                toggleFullscreen(e);
              }}
              className="p-2 sm:p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-purple-400 text-zinc-100 transition-colors rounded-xl hover:bg-white/10 active:scale-95 touch-manipulation z-40 cursor-pointer pointer-events-auto"
              title={isFullscreen || isPseudoFullscreen ? 'خروج از تمام صفحه' : 'تمام صفحه (F)'}
              aria-label="حالت تمام صفحه"
            >
              {isFullscreen || isPseudoFullscreen ? (
                <Minimize2 className="w-5 h-5 sm:w-4 sm:h-4" />
              ) : (
                <Maximize2 className="w-5 h-5 sm:w-4 sm:h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
