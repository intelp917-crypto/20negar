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
  Zap,
  Sliders,
  Loader2,
  AlertCircle,
  RotateCcw as ReloadIcon,
} from 'lucide-react';
import Hls from 'hls.js';
import { api, getStoredToken } from '../api/client.ts';
import { VideoQuality } from '../types/index.ts';

interface VideoPlayerProps {
  videoId: number;
  title: string;
  qualities?: VideoQuality[];
  posterUrl?: string;
  autoPlay?: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  title,
  qualities = [],
  posterUrl,
  autoPlay = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [selectedQuality, setSelectedQuality] = useState<string>('Auto');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [estimatedQualityLevel, setEstimatedQualityLevel] = useState<string>('');

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const availableQualityNames = ['Auto', ...qualities.map((q) => q.quality)];
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

  const fallbackToDirectMp4 = useCallback((qualityTarget: string = 'Original') => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const mp4Url = api.getStreamUrl(videoId, qualityTarget);
    if (video.src !== mp4Url) {
      video.src = mp4Url;
      video.load();
      video.play().catch(() => {});
    }
    setHasError(false);
  }, [videoId]);

  const setupSource = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setHasError(false);
    setErrorMessage(null);
    setIsBuffering(true);

    const savedCurrentTime = video.currentTime;
    const wasPlaying = !video.paused;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (selectedQuality === 'Auto') {
      const hlsUrl = api.getHlsUrl(videoId);
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          xhrSetup: (xhr) => {
            const token = getStoredToken();
            if (token) {
              xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
          },
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          hls.currentLevel = -1; // Auto adaptive bitrate mode based on network speed
          setIsBuffering(false);
          if (savedCurrentTime > 0) video.currentTime = savedCurrentTime;
          if (wasPlaying || autoPlay) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          const level = hls.levels[data.level];
          if (level) {
            setEstimatedQualityLevel(`${level.height}p`);
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.warn('[Hls] Fatal error encountered, smoothly falling back to direct MP4 stream...');
            fallbackToDirectMp4('Original');
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        if (savedCurrentTime > 0) video.currentTime = savedCurrentTime;
        if (wasPlaying || autoPlay) video.play().catch(() => {});
      } else {
        fallbackToDirectMp4('Original');
      }
    } else {
      // Manual Quality Selection
      fallbackToDirectMp4(selectedQuality);
    }
  }, [videoId, selectedQuality, autoPlay, fallbackToDirectMp4]);

  useEffect(() => {
    setupSource();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [setupSource]);

  const handleVideoError = () => {
    const video = videoRef.current;
    if (!video) return;

    console.warn('[VideoPlayer] Video element reported error. Falling back to direct stream...');
    // If we haven't tried direct MP4 yet, try it now
    const directUrl = api.getStreamUrl(videoId, 'Original');
    if (video.src !== directUrl) {
      fallbackToDirectMp4('Original');
    } else {
      setHasError(true);
      setErrorMessage('فایل ویدیو موقتا در دسترس نیست یا در حال پردازش اولیه است.');
      setIsBuffering(false);
    }
  };

  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (!showQualityMenu && !showSpeedMenu) {
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

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
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

  const handleQualitySelect = (quality: string) => {
    setSelectedQuality(quality);
    setShowQualityMenu(false);
  };

  const skipTime = (amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + amount));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, duration]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
    if (videoRef.current.buffered.length > 0) {
      setBufferedEnd(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
    }
  };

  const getQualityButtonLabel = () => {
    if (selectedQuality === 'Auto') {
      return estimatedQualityLevel ? `خودکار (${estimatedQualityLevel})` : 'خودکار (هوشمند)';
    }
    if (selectedQuality === 'Original') return 'کیفیت اصلی';
    return selectedQuality;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && !showQualityMenu && !showSpeedMenu && setControlsVisible(false)}
      className="relative w-full aspect-video bg-zinc-950 rounded-3xl overflow-hidden shadow-2xl group select-none border border-zinc-800 flex items-center justify-center"
      dir="ltr"
    >
      <video
        ref={videoRef}
        poster={posterUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) setDuration(videoRef.current.duration);
          setIsBuffering(false);
        }}
        onCanPlay={() => setIsBuffering(false)}
        onWaiting={() => setIsBuffering(true)}
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
            onClick={() => fallbackToDirectMp4('Original')}
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

      {/* Top Bar with Title & Quality Indicator */}
      <div
        className={`absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 pointer-events-none z-20 ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center justify-between" dir="rtl">
          <h3 className="text-white text-xs sm:text-sm md:text-base font-bold truncate drop-shadow-md pr-1">
            {title}
          </h3>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg bg-zinc-900/90 text-purple-300 border border-purple-500/40 flex items-center gap-1">
              {selectedQuality === 'Auto' ? <Zap className="w-3 h-3 text-amber-400" /> : null}
              {getQualityButtonLabel()}
            </span>
          </div>
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

          {/* Right Controls: DIRECT QUALITY BUTTON, Speed, PIP, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2 relative">
            {/* Direct Quality Button */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowQualityMenu(!showQualityMenu);
                  setShowSpeedMenu(false);
                }}
                className={`px-2 py-1 rounded-xl text-[11px] sm:text-xs font-bold transition-all border flex items-center gap-1 ${
                  showQualityMenu || selectedQuality !== 'Auto'
                    ? 'bg-purple-600 text-white border-purple-500 shadow-md shadow-purple-950/50'
                    : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700'
                }`}
                title="تغییر کیفیت پخش"
              >
                {selectedQuality === 'Auto' ? <Zap className="w-3 h-3 text-amber-300 shrink-0" /> : <Sliders className="w-3 h-3 shrink-0" />}
                <span className="whitespace-nowrap">{getQualityButtonLabel()}</span>
              </button>

              {/* Quality Selection Menu */}
              {showQualityMenu && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-56 bg-zinc-950/95 backdrop-blur-md border border-zinc-700 rounded-2xl shadow-2xl p-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100"
                  dir="rtl"
                >
                  <div className="px-2.5 py-1.5 text-zinc-400 font-bold text-[10px] uppercase border-b border-zinc-800 mb-1 flex items-center justify-between">
                    <span>کیفیت پخش آنلاین</span>
                    <span className="text-[10px] text-purple-400 font-normal">HLS استریم</span>
                  </div>

                  <div className="space-y-1">
                    {/* Auto Adaptive Mode */}
                    <button
                      onClick={() => handleQualitySelect('Auto')}
                      className={`w-full flex items-center justify-between px-2.5 py-2 hover:bg-zinc-800/80 rounded-xl text-right transition-colors ${
                        selectedQuality === 'Auto' ? 'text-purple-300 font-bold bg-purple-950/50 border border-purple-500/30' : 'text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <div>
                          <div>خودکار (تطبیقی با سرعت نت)</div>
                          <div className="text-[10px] text-zinc-400 font-normal mt-0.5">
                            تنظیم خودکار بدون وقفه
                          </div>
                        </div>
                      </div>
                      {selectedQuality === 'Auto' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </button>

                    {/* Manual Qualities */}
                    {availableQualityNames.filter((q) => q !== 'Auto').map((q) => (
                      <button
                        key={q}
                        onClick={() => handleQualitySelect(q)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-zinc-800/80 rounded-xl text-right transition-colors ${
                          selectedQuality === q ? 'text-purple-300 font-bold bg-purple-950/50 border border-purple-500/30' : 'text-zinc-300'
                        }`}
                      >
                        <span className="font-mono">
                          {q === 'Original' ? 'کیفیت اصلی (Master Cut)' : `${q} ${q === '1080p' ? '(Full HD)' : q === '720p' ? '(HD)' : ''}`}
                        </span>
                        {selectedQuality === q && <Check className="w-3.5 h-3.5 text-purple-400" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowQualityMenu(false);
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

            {document.pictureInPictureEnabled && (
              <button
                onClick={togglePictureInPicture}
                className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10 hidden sm:block"
                title="تصویر در تصویر"
              >
                <PictureInPicture className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={toggleFullscreen}
              className="p-1.5 hover:text-purple-400 transition-colors rounded-lg hover:bg-white/10"
              title={isFullscreen ? 'خروج از تمام صفحه' : 'تمام صفحه (F)'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
