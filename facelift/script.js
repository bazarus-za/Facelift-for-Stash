(function () {
  'use strict';

  console.log('[Facelift] Plugin Initializing (Watch Time Tracker)...');

  const { React, ReactDOM } = window.PluginApi;

  if (!React || !ReactDOM) {
    console.error('[Facelift] React or ReactDOM not found in window.PluginApi! Plugin cannot load.');
    return;
  }

  const { useState, useEffect, useMemo, useRef } = React;

  // --- UTILITY: DETECT BASE PATH ---
  function getBasePath() {
    const p = window.location.pathname;
    const stashRoutes = ['/scenes', '/performers', '/studios', '/tags', '/galleries', '/markers', '/movies', '/settings'];
    for (const route of stashRoutes) {
      if (p.includes(route)) return p.split(route)[0] || '';
    }
    return '';
  }

  const BASE_URL = getBasePath();
  const GRAPHQL_ENDPOINT = BASE_URL + '/graphql';

  // --- UTILITY: FORMAT DURATION ---
  const formatDuration = (seconds) => {
    if (!seconds || seconds < 0) return '0s';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
  };

  // --- UTILITY: LOCAL DATE STRING ---
  const getLocalDateString = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // --- UTILITY: GET SHORTS WATCH TIME FOR RANGE ---
  const getShortsWatchTimeForRange = (startTime, endTime) => {
    try {
      const store = JSON.parse(localStorage.getItem('facelift-shorts-watchtime') || '{}');
      let total = 0;
      Object.entries(store).forEach(([dateStr, duration]) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateMs = new Date(y, m - 1, d).getTime();
        if (dateMs >= startTime && dateMs <= endTime) {
          total += parseFloat(duration) || 0;
        }
      });
      return total;
    } catch (e) {
      console.error('[Facelift] Error reading shorts watchtime', e);
      return 0;
    }
  };

  // --- UTILITY: SAFE SPA LINK CLICK ---
  function handleLinkClick(e, url, onNavigate) {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      onNavigate(url);
    }
  }

  // --- GRAPHQL REQUEST ---
  async function graphqlRequest(query, variables = {}) {
    try {
      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
      });
      const result = await response.json();
      if (result.errors) {
        console.error('[Facelift] GraphQL Error', result.errors);
        return null;
      }
      return result.data;
    } catch (e) {
      console.error('[Facelift] Request Error', e);
      return null;
    }
  }

  // --- UTILITY: CALCULATE DEDUPLICATED WATCH TIME FROM PLAY HISTORY ---
  function getDeduplicatedWatchTime(scenes, startTime, endTime) {
    const intervals = [];
    scenes.forEach(scene => {
      if (!scene.play_history) return;
      const duration = scene.play_duration || (scene.files && scene.files[0] ? scene.files[0].duration : 0);
      const avgDuration = (duration || 0) / (scene.play_count || 1);

      scene.play_history.forEach(ts => {
        const playTime = new Date(ts).getTime();
        if (playTime >= startTime && playTime <= endTime) {
          intervals.push({
            start: playTime,
            end: playTime + avgDuration * 1000
          });
        }
      });
    });

    intervals.sort((a, b) => a.start - b.start);
    const merged = [];
    if (intervals.length > 0) {
      let current = intervals[0];
      for (let i = 1; i < intervals.length; i++) {
        const next = intervals[i];
        if (next.start <= current.end) {
          current.end = Math.max(current.end, next.end);
        } else {
          merged.push(current);
          current = next;
        }
      }
      merged.push(current);
    }

    let totalSeconds = 0;
    merged.forEach(interval => {
      totalSeconds += (interval.end - interval.start) / 1000;
    });

    return totalSeconds;
  }

  // --- MAIN LANDING PAGE COMPONENT ---
  const FaceliftLanding = ({ onShowOriginal }) => {
    const isMobile = useMemo(() => {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    }, []);

    const [loading, setLoading] = useState(true);
    const [playedScenes, setPlayedScenes] = useState([]);
    const [recentlyPlayed, setRecentlyPlayed] = useState([]);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('dashboard');

    useEffect(() => {
      if (activeTab === 'shorts') {
        document.body.classList.add('facelift-shorts-active');
        const main = document.querySelector('.main') || document.querySelector('.main-container');
        if (main) main.classList.add('facelift-shorts-active');
      } else {
        document.body.classList.remove('facelift-shorts-active');
        const main = document.querySelector('.main') || document.querySelector('.main-container');
        if (main) main.classList.remove('facelift-shorts-active');
      }
      return () => {
        document.body.classList.remove('facelift-shorts-active');
        const main = document.querySelector('.main') || document.querySelector('.main-container');
        if (main) main.classList.remove('facelift-shorts-active');
      };
    }, [activeTab]);

    // Spotlight Selection State
    const [selectedRange, setSelectedRange] = useState('today');
    const [customRangeStart, setCustomRangeStart] = useState('');
    const [customRangeEnd, setCustomRangeEnd] = useState('');
    const [spotlightScenes, setSpotlightScenes] = useState([]);
    const [spotlightDateText, setSpotlightDateText] = useState('');
    const [spotlightRelativeText, setSpotlightRelativeText] = useState('');
    const [spotlightIsExact, setSpotlightIsExact] = useState(false);
    const [customSpotlightDate, setCustomSpotlightDate] = useState(null);
    const [spotlightWatchTime, setSpotlightWatchTime] = useState(0);
    const [spotlightShortsWatchTime, setSpotlightShortsWatchTime] = useState(0);
    const [spotlightTotalPlays, setSpotlightTotalPlays] = useState(0);
    const [spotlightSessionsCount, setSpotlightSessionsCount] = useState(0);

    // Pagination / "Show More" limit for Time Machine
    const [visibleCount, setVisibleCount] = useState(8);

    // Mood board playlist state
    const [selectedMood, setSelectedMood] = useState(null);
    const [moodScenes, setMoodScenes] = useState([]);
    const [loadingMood, setLoadingMood] = useState(false);

    // Image Gallery State
    const [galleryImages, setGalleryImages] = useState([]);
    const [loadingGallery, setLoadingGallery] = useState(false);
    const [activeLightboxIndex, setActiveLightboxIndex] = useState(null);

    // Collage Workspace Canvas State
    const [selectedImageIds, setSelectedImageIds] = useState([]);
    const [canvasWindows, setCanvasWindows] = useState([]);
    const [isCanvasOpen, setIsCanvasOpen] = useState(false);

    const toggleImageSelection = (imgId) => {
      setSelectedImageIds(prev =>
        prev.includes(imgId) ? prev.filter(id => id !== imgId) : [...prev, imgId]
      );
    };

    const clearImageSelection = () => {
      setSelectedImageIds([]);
    };

    const openCanvas = () => {
      const selected = galleryImages.filter(img => selectedImageIds.includes(img.id));
      if (selected.length === 0) return;
      
      const N = selected.length;
      const canvasWidth = window.innerWidth || 1600;
      const canvasHeight = (window.innerHeight || 900) - 80;

      // Calculate grid columns and rows
      let cols = 1;
      let rows = 1;
      if (N > 6) {
        cols = 3;
        rows = 3;
      } else if (N > 4) {
        cols = 3;
        rows = 2;
      } else if (N > 2) {
        cols = 2;
        rows = 2;
      } else if (N > 1) {
        cols = 2;
        rows = 1;
      }

      const cellWidth = (canvasWidth - 100) / cols;
      const cellHeight = (canvasHeight - 100) / rows;

      const windows = selected.map((img, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);

        const centerX = 50 + col * cellWidth + cellWidth / 2;
        const centerY = 50 + row * cellHeight + cellHeight / 2;

        // Base size (takes up 75% of cell size, capped at a nice large size e.g. 500px)
        const baseW = Math.min(cellWidth * 0.75, 500);
        const baseH = Math.min(cellHeight * 0.75, 500);

        const x = centerX - baseW / 2;
        const y = centerY - baseH / 2;

        return {
          id: img.id,
          img,
          x,
          y,
          width: baseW,
          height: baseH,
          scale: 1,
          panX: 0,
          panY: 0,
          zIndex: 10 + index,
          aspectRatioSet: false
        };
      });
      setCanvasWindows(windows);
      setIsCanvasOpen(true);
    };

    const [visibleGalleryCount, setVisibleGalleryCount] = useState(9);
    const [loadingMoreGallery, setLoadingMoreGallery] = useState(false);

    const visibleImages = useMemo(() => {
      return galleryImages.slice(0, visibleGalleryCount);
    }, [galleryImages, visibleGalleryCount]);

    const loadMoreGalleryImages = async () => {
      setLoadingMoreGallery(true);
      try {
        const result = await graphqlRequest(`
          query FaceliftLoadMoreImages {
            findImages(filter: { per_page: 12, sort: "random" }) {
              images { id title paths { thumbnail image } }
            }
          }
        `);
        const newImgs = (result?.findImages?.images) || [];
        
        // Filter out duplicates
        const existingIds = new Set(galleryImages.map(img => img.id));
        const filteredNewImgs = newImgs.filter(img => !existingIds.has(img.id));
        
        setGalleryImages(prev => [...prev, ...filteredNewImgs]);
        setVisibleGalleryCount(prev => prev + 12);
      } catch (err) {
        console.error('Load more gallery images failed:', err);
      }
      setLoadingMoreGallery(false);
    };

    // Zoom & Drag Lightbox States
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const lightboxImgRef = useRef(null);

    const greeting = useMemo(() => {
      const hours = new Date().getHours();
      if (hours < 12) return 'Good Morning 🌅';
      if (hours < 17) return 'Good Afternoon ☀️';
      if (hours < 22) return 'Good Evening 🌙';
      return 'Happy Late Night Session 🌌';
    }, []);

    // --- FETCH SCENES DATA ---
    const fetchData = async () => {
      const query = `
        query FaceliftDashboardData {
          played: findScenes(scene_filter: { play_count: { value: 0, modifier: GREATER_THAN } }, filter: { per_page: -1 }) {
            scenes {
              id
              title
              play_history
              play_count
              play_duration
              last_played_at
              files {
                duration
                basename
              }
              paths {
                screenshot
                preview
              }
              studio {
                name
              }
              tags {
                id
                name
                image_path
              }
              performers {
                id
                name
                image_path
              }
            }
          }
          recentlyPlayed: findScenes(filter: { per_page: 8, sort: "last_played_at", direction: DESC }) {
            scenes {
              id
              title
              last_played_at
              files {
                duration
                basename
              }
              paths {
                screenshot
                preview
              }
              studio {
                name
              }
            }
          }
        }
      `;

      setLoading(true);
      const data = await graphqlRequest(query);

      if (data) {
        if (data.played) setPlayedScenes(data.played.scenes);
        if (data.recentlyPlayed) setRecentlyPlayed(data.recentlyPlayed.scenes);
        setLoading(false);
      } else {
        setError('Failed to load dashboard data from Stash.');
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchData();
    }, []);

    // Group played scenes by date
    const playsByDate = useMemo(() => {
      const map = {};
      playedScenes.forEach(scene => {
        if (scene.play_history) {
          scene.play_history.forEach(ts => {
            const dateObj = new Date(ts);
            const dateStr = getLocalDateString(dateObj);
            if (!map[dateStr]) {
              map[dateStr] = [];
            }
            if (!map[dateStr].some(s => s.id === scene.id)) {
              map[dateStr].push(scene);
            }
          });
        }
      });
      return map;
    }, [playedScenes]);

    // Parse top viewed tags for mood generator
    const topTags = useMemo(() => {
      const counts = {};
      const tagDetails = {};

      playedScenes.forEach(scene => {
        if (scene.tags) {
          scene.tags.forEach(t => {
            counts[t.id] = (counts[t.id] || 0) + (scene.play_count || 1);
            tagDetails[t.id] = t.name;
          });
        }
      });

      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(entry => ({ id: entry[0], name: tagDetails[entry[0]] }));

      const fallbacks = [
        { id: "Solo", name: "Solo" },
        { id: "POV", name: "POV" },
        { id: "Amateur", name: "Amateur" },
        { id: "Lesbian", name: "Lesbian" },
        { id: "Anal", name: "Anal" },
        { id: "Blowjob", name: "Blowjob" },
        { id: "Hardcore", name: "Hardcore" },
        { id: "Milf", name: "Milf" },
        { id: "Cum", name: "Cum" },
        { id: "Compilation", name: "Compilation" }
      ];

      fallbacks.forEach(f => {
        if (sorted.length < 10 && !sorted.some(s => s.name.toLowerCase() === f.name.toLowerCase())) {
          sorted.push(f);
        }
      });

      return sorted;
    }, [playedScenes]);

    useEffect(() => {
      if (topTags.length > 0 && !selectedMood) {
        setSelectedMood(topTags[0]);
      }
    }, [topTags]);

    // --- MOOD PLAYLIST GENERATOR FETCH ---
    const fetchMoodPlaylist = async (moodTag) => {
      if (!moodTag) return;
      setLoadingMood(true);

      const isRealTag = /^\d+$/.test(moodTag.id);

      const query = isRealTag
        ? `
          query FindMoodScenes($tagId: ID!) {
            findScenes(scene_filter: { tags: { value: [$tagId], modifier: INCLUDES } }, filter: { per_page: 10, sort: "random" }) {
              scenes {
                id
                title
                files {
                  duration
                  basename
                }
                paths {
                  screenshot
                  preview
                }
                studio {
                  name
                }
                play_count
              }
            }
          }
        `
        : `
          query FindMoodScenesByName($tagName: String!) {
            findScenes(scene_filter: { tags: { value: [$tagName], modifier: INCLUDES } }, filter: { per_page: 10, sort: "random" }) {
              scenes {
                id
                title
                files {
                  duration
                  basename
                }
                paths {
                  screenshot
                  preview
                }
                studio {
                  name
                }
                play_count
              }
            }
          }
        `;

      const variables = isRealTag ? { tagId: moodTag.id } : { tagName: moodTag.name };
      const data = await graphqlRequest(query, variables);

      if (data && data.findScenes && data.findScenes.scenes.length > 0) {
        setMoodScenes(data.findScenes.scenes);
      } else {
        const shuffled = [...playedScenes].sort(() => 0.5 - Math.random());
        setMoodScenes(shuffled.slice(0, 10));
      }
      setLoadingMood(false);
    };

    useEffect(() => {
      fetchMoodPlaylist(selectedMood);
    }, [selectedMood, playedScenes]);

    // --- RANDOM IMAGE GALLERY FETCH ---
    const fetchGalleryImages = async () => {
      setLoadingGallery(true);
      try {
        const randomResult = await graphqlRequest(`
          query FaceliftRandomImages {
            findImages(filter: { per_page: 12, sort: "random" }) {
              images { id title paths { thumbnail image } }
            }
          }
        `);
        const randomImgs = (randomResult?.findImages?.images) || [];
        
        const seen = new Set();
        const uniqueImgs = randomImgs.filter(img => {
          if (seen.has(img.id)) return false;
          seen.add(img.id);
          return true;
        });
        
        setGalleryImages(uniqueImgs);
        setVisibleGalleryCount(9);
      } catch (err) {
        console.error('Gallery fetch failed:', err);
      }
      setLoadingGallery(false);
    };

    useEffect(() => {
      fetchGalleryImages();
    }, []);

    // --- KEYBOARD LISTENER & ZOOM RESET FOR LIGHTBOX ---
    useEffect(() => {
      const handleKeyDown = (e) => {
        if (activeLightboxIndex !== null) {
          if (e.key === 'ArrowLeft') {
            setScale(1);
            setOffset({ x: 0, y: 0 });
            setIsDragging(false);
            setActiveLightboxIndex(prev => (prev === 0 ? visibleImages.length - 1 : prev - 1));
          } else if (e.key === 'ArrowRight') {
            setScale(1);
            setOffset({ x: 0, y: 0 });
            setIsDragging(false);
            setActiveLightboxIndex(prev => (prev === visibleImages.length - 1 ? 0 : prev + 1));
          } else if (e.key === 'Escape') {
            setScale(1);
            setOffset({ x: 0, y: 0 });
            setIsDragging(false);
            setActiveLightboxIndex(null);
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [activeLightboxIndex, visibleImages]);

    // Handle passive-false wheel zoom listener with proper cleanup
    useEffect(() => {
      const img = lightboxImgRef.current;
      if (!img) return;

      const onWheel = (e) => {
        e.preventDefault();
        const zoomIntensity = 0.15;
        setScale(prevScale => {
          let newScale = prevScale + (e.deltaY < 0 ? zoomIntensity : -zoomIntensity);
          newScale = Math.max(1, Math.min(newScale, 8));
          if (newScale === 1) {
            setOffset({ x: 0, y: 0 });
          }
          return newScale;
        });
      };

      img.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        img.removeEventListener('wheel', onWheel);
      };
    }, [activeLightboxIndex]);

    // --- TIME MACHINE DATE & RANGE CALCULATIONS ---
    useEffect(() => {
      if (playedScenes.length === 0) return;

      const calculateSpotlight = () => {
        const today = new Date();
        let start = null;
        let end = null;
        let isRange = true;

        if (selectedRange === '1_year_ago') {
          isRange = false;
          let targetDateObj;
          if (customSpotlightDate) {
            targetDateObj = customSpotlightDate;
          } else {
            targetDateObj = new Date();
            targetDateObj.setFullYear(today.getFullYear() - 1);
          }

          const targetMidnight = new Date(targetDateObj.getFullYear(), targetDateObj.getMonth(), targetDateObj.getDate());
          const targetStr = getLocalDateString(targetMidnight);
          const targetTime = targetMidnight.getTime();
          const targetEndTime = targetTime + 24 * 60 * 60 * 1000 - 1;

          if (playsByDate[targetStr] && playsByDate[targetStr].length > 0) {
            const matchedScenes = playsByDate[targetStr];
            setSpotlightScenes(matchedScenes);
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            setSpotlightDateText(targetMidnight.toLocaleDateString(undefined, options));
            setSpotlightRelativeText(customSpotlightDate ? 'on your selected date' : 'exactly 1 year ago today');
            setSpotlightIsExact(true);

            // Calculate watch time & plays & collect timestamps
            let wt = getDeduplicatedWatchTime(matchedScenes, targetTime, targetEndTime);
            let totalP = 0;
            const timestamps = [];
            matchedScenes.forEach(scene => {
              if (scene.play_history) {
                scene.play_history.forEach(ts => {
                  const playTime = new Date(ts).getTime();
                  if (playTime >= targetTime && playTime <= targetEndTime) {
                    timestamps.push(playTime);
                    totalP++;
                  }
                });
              }
            });
            const shortsWT = getShortsWatchTimeForRange(targetTime, targetEndTime);
            setSpotlightShortsWatchTime(shortsWT);
            setSpotlightWatchTime(wt + shortsWT);
            setSpotlightTotalPlays(totalP);

            // Group timestamps into sessions (15-min gap limit)
            timestamps.sort((a, b) => a - b);
            let sessions = 0;
            if (timestamps.length > 0) {
              sessions = 1;
              const limit = 15 * 60 * 1000;
              for (let i = 1; i < timestamps.length; i++) {
                if (timestamps[i] - timestamps[i - 1] > limit) {
                  sessions++;
                }
              }
            }
            setSpotlightSessionsCount(sessions);
          } else {
            const dates = Object.keys(playsByDate);
            if (dates.length === 0) {
              setSpotlightScenes([]);
              setSpotlightDateText('');
              setSpotlightRelativeText('');
              setSpotlightIsExact(false);
              setSpotlightWatchTime(0);
              setSpotlightShortsWatchTime(0);
              setSpotlightTotalPlays(0);
              setSpotlightSessionsCount(0);
              return;
            }

            let closestDateStr = null;
            let minDiff = Infinity;

            dates.forEach(dStr => {
              const [y, m, d] = dStr.split('-').map(Number);
              const dDate = new Date(y, m - 1, d);
              const diff = Math.abs(dDate.getTime() - targetTime);
              if (diff < minDiff) {
                minDiff = diff;
                closestDateStr = dStr;
              }
            });

            if (closestDateStr) {
              const [y, m, d] = closestDateStr.split('-').map(Number);
              const closestDateObj = new Date(y, m - 1, d);
              const dayDiff = Math.round((closestDateObj.getTime() - targetTime) / (1000 * 60 * 60 * 24));
              const closestTime = closestDateObj.getTime();
              const closestEndTime = closestTime + 24 * 60 * 60 * 1000 - 1;
              const matchedScenes = playsByDate[closestDateStr];

              setSpotlightScenes(matchedScenes);
              const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
              setSpotlightDateText(closestDateObj.toLocaleDateString(undefined, options));

              let relativeStr = '';
              if (dayDiff === 0) {
                relativeStr = customSpotlightDate ? 'on your selected date' : 'exactly 1 year ago today';
              } else if (customSpotlightDate) {
                if (dayDiff > 0) {
                  relativeStr = `${dayDiff} day${dayDiff !== 1 ? 's' : ''} after your selected date (closest activity)`;
                } else {
                  relativeStr = `${Math.abs(dayDiff)} day${Math.abs(dayDiff) !== 1 ? 's' : ''} before your selected date (closest activity)`;
                }
              } else {
                const diffText = Math.abs(dayDiff) === 1 ? '1 day' : `${Math.abs(dayDiff)} days`;
                if (dayDiff > 0) {
                  relativeStr = `1 year and ${dayDiff} day${dayDiff !== 1 ? 's' : ''} ago (closest activity)`;
                } else {
                  relativeStr = `${diffText} before your 1-year anniversary (closest activity)`;
                }
              }
              setSpotlightRelativeText(relativeStr);
              setSpotlightIsExact(false);

              // Calculate watch time & plays & collect timestamps
              let wt = getDeduplicatedWatchTime(matchedScenes, closestTime, closestEndTime);
              let totalP = 0;
              const timestamps = [];
              matchedScenes.forEach(scene => {
                if (scene.play_history) {
                  scene.play_history.forEach(ts => {
                    const playTime = new Date(ts).getTime();
                    if (playTime >= closestTime && playTime <= closestEndTime) {
                      timestamps.push(playTime);
                      totalP++;
                    }
                  });
                }
              });
              const shortsWT = getShortsWatchTimeForRange(closestTime, closestEndTime);
              setSpotlightShortsWatchTime(shortsWT);
              setSpotlightWatchTime(wt + shortsWT);
              setSpotlightTotalPlays(totalP);

              // Group timestamps into sessions (15-min gap limit)
              timestamps.sort((a, b) => a - b);
              let sessions = 0;
              if (timestamps.length > 0) {
                sessions = 1;
                const limit = 15 * 60 * 1000;
                for (let i = 1; i < timestamps.length; i++) {
                  if (timestamps[i] - timestamps[i - 1] > limit) {
                    sessions++;
                  }
                }
              }
              setSpotlightSessionsCount(sessions);
            }
          }
          return;
        }

        // Pre-defined and custom date ranges
        if (selectedRange === 'today') {
          start = today;
          end = today;
          setSpotlightRelativeText('today');
        } else if (selectedRange === 'last_7_days') {
          start = new Date();
          start.setDate(today.getDate() - 7);
          end = today;
          setSpotlightRelativeText('in the last 7 days');
        } else if (selectedRange === 'last_30_days') {
          start = new Date();
          start.setDate(today.getDate() - 30);
          end = today;
          setSpotlightRelativeText('in the last 30 days');
        } else if (selectedRange === 'last_90_days') {
          start = new Date();
          start.setDate(today.getDate() - 90);
          end = today;
          setSpotlightRelativeText('in the last 3 months');
        } else if (selectedRange === 'last_365_days') {
          start = new Date();
          start.setDate(today.getDate() - 365);
          end = today;
          setSpotlightRelativeText('in the last 1 year');
        } else if (selectedRange === 'custom_range') {
          if (customRangeStart) {
            const [y, m, d] = customRangeStart.split('-').map(Number);
            start = new Date(y, m - 1, d);
          }
          if (customRangeEnd) {
            const [y, m, d] = customRangeEnd.split('-').map(Number);
            end = new Date(y, m - 1, d);
          }
          setSpotlightRelativeText('in your custom range');
        }

        if (start && end) {
          const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
          const endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
          const startTime = startMidnight.getTime();
          const endTime = endMidnight.getTime();

          let wt = getDeduplicatedWatchTime(playedScenes, startTime, endTime);
          let totalP = 0;
          const timestamps = [];
          playedScenes.forEach(scene => {
            if (scene.play_history) {
              scene.play_history.forEach(ts => {
                const playTime = new Date(ts).getTime();
                if (playTime >= startTime && playTime <= endTime) {
                  timestamps.push(playTime);
                  totalP++;
                }
              });
            }
          });

          const filtered = playedScenes.filter(scene => {
            if (!scene.play_history) return false;
            return scene.play_history.some(ts => {
              const playTime = new Date(ts).getTime();
              return playTime >= startTime && playTime <= endTime;
            });
          });

          filtered.sort((a, b) => {
            const tA = new Date(a.last_played_at).getTime();
            const tB = new Date(b.last_played_at).getTime();
            return tB - tA;
          });

          setSpotlightScenes(filtered);
          const shortsWT = getShortsWatchTimeForRange(startTime, endTime);
          setSpotlightShortsWatchTime(shortsWT);
          setSpotlightWatchTime(wt + shortsWT);
          setSpotlightTotalPlays(totalP);

          // Group timestamps into sessions (15-min gap limit)
          timestamps.sort((a, b) => a - b);
          let sessions = 0;
          if (timestamps.length > 0) {
            sessions = 1;
            const limit = 15 * 60 * 1000;
            for (let i = 1; i < timestamps.length; i++) {
              if (timestamps[i] - timestamps[i - 1] > limit) {
                sessions++;
              }
            }
          }
          setSpotlightSessionsCount(sessions);

          const options = { year: 'numeric', month: 'short', day: 'numeric' };
          const startStr = startMidnight.toLocaleDateString(undefined, options);
          const endStr = endMidnight.toLocaleDateString(undefined, options);
          setSpotlightDateText(selectedRange === 'today' ? startStr : `${startStr} - ${endStr}`);
          setSpotlightIsExact(true);
        }
      };

      calculateSpotlight();
      setVisibleCount(8); // Reset page limits on range changes
    }, [playedScenes, playsByDate, selectedRange, customSpotlightDate, customRangeStart, customRangeEnd]);

    const handleRangeChange = (e) => {
      const val = e.target.value;
      setSelectedRange(val);

      const today = new Date();
      let target = new Date();

      if (val === '1_year_ago') {
        target.setFullYear(today.getFullYear() - 1);
        setCustomSpotlightDate(target);
      } else if (val === 'custom_range') {
        const defaultStart = new Date();
        defaultStart.setDate(today.getDate() - 7);
        setCustomRangeStart(getLocalDateString(defaultStart));
        setCustomRangeEnd(getLocalDateString(today));
      }
    };

    // --- QUICK ACTION LAUNCHERS ---
    const handleSurpriseMe = () => {
      if (playedScenes.length === 0) return;
      const randomScene = playedScenes[Math.floor(Math.random() * playedScenes.length)];
      navigateToUrl(`/scenes/${randomScene.id}`);
    };

    const handleUnwatchedGem = async () => {
      const query = `
        query FindRandomUnwatched {
          findScenes(scene_filter: { play_count: { value: 0, modifier: EQUALS } }, filter: { per_page: 1, sort: "random" }) {
            scenes {
              id
            }
          }
        }
      `;
      const data = await graphqlRequest(query);
      if (data && data.findScenes && data.findScenes.scenes.length > 0) {
        navigateToUrl(`/scenes/${data.findScenes.scenes[0].id}`);
      } else {
        alert("No unwatched scenes found in your library!");
      }
    };

    const handleTimeMachine = () => {
      const dates = Object.keys(playsByDate);
      if (dates.length === 0) return;
      const randomDateStr = dates[Math.floor(Math.random() * dates.length)];
      const [y, m, d] = randomDateStr.split('-').map(Number);

      setSelectedRange('1_year_ago');
      setCustomSpotlightDate(new Date(y, m - 1, d));
    };

    const navigateToUrl = (url) => {
      window.history.pushState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    };

    const handleShowMore = () => {
      setVisibleCount(prev => prev + 8);
    };

    if (loading) {
      return React.createElement('div', { className: 'facelift-landing-wrapper' },
        React.createElement('div', { className: 'facelift-loader-container' },
          React.createElement('span', { className: 'facelift-spinner' })
        )
      );
    }

    if (error) {
      return React.createElement('div', { className: 'facelift-landing-wrapper' },
        React.createElement('div', { className: 'facelift-card facelift-empty-state' },
          React.createElement('div', { className: 'facelift-empty-icon' }, '⚠️'),
          React.createElement('div', { className: 'facelift-empty-text' }, error),
          React.createElement('button', { className: 'btn btn-primary mt-3', onClick: onShowOriginal }, 'Back to Classic Dashboard')
        )
      );
    }

    // Render Lightbox if active
    const renderLightbox = () => {
      if (activeLightboxIndex === null || visibleImages.length === 0) return null;

      const currentImg = visibleImages[activeLightboxIndex];

      const handlePrev = (e) => {
        if (e) e.stopPropagation();
        setScale(1);
        setOffset({ x: 0, y: 0 });
        setIsDragging(false);
        setActiveLightboxIndex(prev => (prev === 0 ? visibleImages.length - 1 : prev - 1));
      };

      const handleNext = (e) => {
        if (e) e.stopPropagation();
        setScale(1);
        setOffset({ x: 0, y: 0 });
        setIsDragging(false);
        setActiveLightboxIndex(prev => (prev === visibleImages.length - 1 ? 0 : prev + 1));
      };

      const handleClose = () => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
        setIsDragging(false);
        setActiveLightboxIndex(null);
      };

      const handleMouseDown = (e) => {
        if (scale <= 1) return;
        e.preventDefault();
        setIsDragging(true);
        dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
      };

      const handleMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setOffset({ x: dx, y: dy });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
      };

      return React.createElement('div', {
        className: 'facelift-lightbox-backdrop',
        onClick: handleClose
      },
        // Header info & Close
        React.createElement('div', { className: 'facelift-lightbox-header', onClick: (e) => e.stopPropagation() },
          React.createElement('span', { className: 'facelift-lightbox-counter' },
            `${activeLightboxIndex + 1} / ${visibleImages.length}`
          ),
          React.createElement('button', { className: 'facelift-lightbox-close', onClick: handleClose }, '✕')
        ),

        // Left Arrow
        React.createElement('button', {
          className: 'facelift-lightbox-arrow left',
          onClick: handlePrev
        }, '‹'),

        // Image Container
        React.createElement('div', {
          className: 'facelift-lightbox-content',
          onClick: (e) => e.stopPropagation()
        },
          React.createElement('img', {
            ref: lightboxImgRef,
            src: currentImg?.paths?.image || currentImg?.paths?.thumbnail || '',
            className: 'facelift-lightbox-image',
            alt: currentImg.title,
            style: {
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.15s ease-out',
              cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
            },
            onMouseDown: handleMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseUp
          })
        ),

        // Right Arrow
        React.createElement('button', {
          className: 'facelift-lightbox-arrow right',
          onClick: handleNext
        }, '›'),

        // Footer Title & Button to go to native Image page
        React.createElement('div', { className: 'facelift-lightbox-footer', onClick: (e) => e.stopPropagation() },
          React.createElement('h3', { className: 'facelift-lightbox-title' }, currentImg.title || `Image ${currentImg.id}`),
          React.createElement('a', {
            href: `/images/${currentImg.id}`,
            className: 'facelift-lightbox-link',
            onClick: (e) => {
              e.preventDefault();
              navigateToUrl(`/images/${currentImg.id}`);
            }
          }, 'View Original Page ↗')
        )
      );
    };

    return React.createElement('div', { className: `facelift-landing-wrapper ${isMobile ? 'facelift-mobile' : ''} ${activeTab === 'shorts' ? 'facelift-shorts-mode' : ''}` },
      // 1. GREETING & LOW-PROFILE TOGGLE
      React.createElement('div', { className: 'facelift-hero' },
        React.createElement('div', { className: 'facelift-hero-left' },
          React.createElement('h1', null, greeting)
        ),
        React.createElement('div', { className: 'facelift-hero-right' },
          React.createElement('button', { className: 'facelift-btn-classic-toggle', onClick: onShowOriginal },
            React.createElement('span', null, '🏛️'),
            'Classic Dashboard'
          )
        )
      ),

      // Tab Navigation Bar
      React.createElement('div', { className: 'facelift-nav-bar' },
        React.createElement('button', {
          className: `facelift-nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`,
          onClick: () => setActiveTab('dashboard')
        }, '✨ Dashboard'),
        React.createElement('button', {
          className: `facelift-nav-tab ${activeTab === 'shorts' ? 'active' : ''}`,
          onClick: () => setActiveTab('shorts')
        }, '🌀 Stash Shorts'),
        React.createElement('button', {
          className: `facelift-nav-tab ${activeTab === 'trends' ? 'active' : ''}`,
          onClick: () => setActiveTab('trends')
        }, '📊 Daily Trends')
      ),

      activeTab === 'shorts'
        ? React.createElement(ShortsFeed, { onNavigate: navigateToUrl })
        : activeTab === 'trends'
          ? React.createElement(DailyTrends, { playedScenes: playedScenes, onNavigate: navigateToUrl })
          : React.createElement(React.Fragment, null,
            // 2. MAIN LAYOUT: ROW 1 (TIME MACHINE & WIDGETS)
            React.createElement('div', { className: 'facelift-row facelift-row-split' },
              // A. Left Box: Time Machine
        React.createElement('div', { className: 'facelift-card' },
          React.createElement('div', { className: 'facelift-section-header' },
            React.createElement('div', null,
              React.createElement('h2', { className: 'facelift-section-title' },
                React.createElement('span', { className: 'facelift-section-title-icon' }, '⏳'),
                'History Time Machine'
              ),
              React.createElement('div', { className: 'facelift-badge-relative' },
                spotlightScenes.length > 0
                  ? `Summary of activity ${spotlightRelativeText}:`
                  : 'No playback history recorded for this range.'
              )
            ),
            React.createElement('div', { className: 'facelift-controls-group' },
              // Range selection dropdown
              React.createElement('select', {
                className: 'facelift-select',
                value: selectedRange,
                onChange: handleRangeChange
              },
                React.createElement('option', { value: '1_year_ago' }, '⏳ On This Day (1 Year Ago)'),
                React.createElement('option', { value: 'today' }, '📅 Today'),
                React.createElement('option', { value: 'last_7_days' }, '📅 Last 7 Days'),
                React.createElement('option', { value: 'last_30_days' }, '📅 Last 30 Days'),
                React.createElement('option', { value: 'last_90_days' }, '📅 Last 3 Months'),
                React.createElement('option', { value: 'last_365_days' }, '📅 Last 1 Year'),
                React.createElement('option', { value: 'custom_range' }, '⚙️ Custom Range...')
              ),
              // Custom range date pickers
              selectedRange === 'custom_range' && React.createElement('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center' } },
                React.createElement('input', {
                  type: 'date',
                  className: 'facelift-date-input',
                  value: customRangeStart,
                  onChange: (e) => setCustomRangeStart(e.target.value)
                }),
                React.createElement('span', { style: { color: 'var(--fl-text-secondary)', fontSize: '0.8rem' } }, 'to'),
                React.createElement('input', {
                  type: 'date',
                  className: 'facelift-date-input',
                  value: customRangeEnd,
                  onChange: (e) => setCustomRangeEnd(e.target.value)
                })
              ),
              spotlightScenes.length > 0 && React.createElement('span', { className: 'facelift-badge-date' },
                spotlightDateText
              )
            )
          ),
          // Scenes spotlight list
          spotlightScenes.length > 0
            ? React.createElement('div', null,
                React.createElement('div', { className: 'facelift-stats-row' },
                  React.createElement('div', { className: 'facelift-stat-card' },
                    React.createElement('span', { className: 'facelift-stat-icon' }, '⏱️'),
                    React.createElement('div', { className: 'facelift-stat-details' },
                      React.createElement('span', { className: 'facelift-stat-value' }, `${(spotlightWatchTime / 3600).toFixed(1)} hrs`),
                      React.createElement('span', { className: 'facelift-stat-label' }, 'Total Hours')
                    )
                  ),
                  React.createElement('div', { className: 'facelift-stat-card' },
                    React.createElement('span', { className: 'facelift-stat-icon' }, '⏳'),
                    React.createElement('div', { className: 'facelift-stat-details' },
                      React.createElement('span', { className: 'facelift-stat-value' }, `${Math.round(spotlightWatchTime / 60)} mins`),
                      React.createElement('span', { className: 'facelift-stat-label' }, 'Total Minutes')
                    )
                  ),
                  React.createElement('div', { className: 'facelift-stat-card' },
                    React.createElement('span', { className: 'facelift-stat-icon' }, '🌀'),
                    React.createElement('div', { className: 'facelift-stat-details' },
                      React.createElement('span', { className: 'facelift-stat-value' }, `${Math.round(spotlightShortsWatchTime / 60)} mins`),
                      React.createElement('span', { className: 'facelift-stat-label' }, 'Shorts Time')
                    )
                  ),
                  React.createElement('div', { className: 'facelift-stat-card' },
                    React.createElement('span', { className: 'facelift-stat-icon' }, '📺'),
                    React.createElement('div', { className: 'facelift-stat-details' },
                      React.createElement('span', { className: 'facelift-stat-value' }, spotlightSessionsCount),
                      React.createElement('span', { className: 'facelift-stat-label' }, 'Sessions')
                    )
                  ),
                  React.createElement('div', { className: 'facelift-stat-card' },
                    React.createElement('span', { className: 'facelift-stat-icon' }, '🎬'),
                    React.createElement('div', { className: 'facelift-stat-details' },
                      React.createElement('span', { className: 'facelift-stat-value' }, spotlightScenes.length),
                      React.createElement('span', { className: 'facelift-stat-label' }, 'Unique Scenes')
                    )
                  )
                ),
                React.createElement('div', { className: 'facelift-scenes-slider' },
                  spotlightScenes.slice(0, visibleCount).map(scene =>
                    React.createElement(SceneCard, { key: scene.id, scene: scene, onNavigate: navigateToUrl })
                  )
                ),
                spotlightScenes.length > visibleCount && React.createElement('div', { className: 'facelift-showmore-container' },
                  React.createElement('button', { className: 'facelift-btn-showmore', onClick: handleShowMore },
                    `Show More (${spotlightScenes.length - visibleCount} left)`
                  )
                )
              )
            : React.createElement('div', { className: 'facelift-empty-state' },
                React.createElement('div', { className: 'facelift-empty-icon' }, '📅'),
                React.createElement('div', { className: 'facelift-empty-text' }, 'No scenes viewed on this date range.')
              )
        ),

        // B. Right Box: Quick Launchpad
        React.createElement('div', { className: 'facelift-card facelift-launcher-column' },
          React.createElement('h3', { className: 'facelift-section-title' }, 'Quick Launcher'),
          React.createElement('button', { className: 'facelift-launcher-btn primary', onClick: handleSurpriseMe },
            React.createElement('span', { className: 'facelift-launcher-icon' }, '🎲'),
            React.createElement('div', { className: 'facelift-launcher-text' },
              React.createElement('span', { className: 'facelift-launcher-title' }, 'Surprise Me'),
              React.createElement('span', { className: 'facelift-launcher-desc' }, 'Stream a random played scene')
            )
          ),
          React.createElement('button', { className: 'facelift-launcher-btn secondary', onClick: handleUnwatchedGem },
            React.createElement('span', { className: 'facelift-launcher-icon' }, '💎'),
            React.createElement('div', { className: 'facelift-launcher-text' },
              React.createElement('span', { className: 'facelift-launcher-title' }, 'Unwatched Gem'),
              React.createElement('span', { className: 'facelift-launcher-desc' }, 'Play a random unwatched video')
            )
          ),
          React.createElement('button', { className: 'facelift-launcher-btn accent', onClick: handleTimeMachine },
            React.createElement('span', { className: 'facelift-launcher-icon' }, '🌀'),
            React.createElement('div', { className: 'facelift-launcher-text' },
              React.createElement('span', { className: 'facelift-launcher-title' }, 'Random Warp'),
              React.createElement('span', { className: 'facelift-launcher-desc' }, 'Warp to a random date in history')
            )
          )
        )
      ),

      // 3. ROW 2+3: Two-column layout, each side stacks vertically
      React.createElement('div', { className: 'facelift-row facelift-row-half' },

        // A. Left Column Stack: Recently Played + Image Spotlight
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 } },
          // Recently Played
          React.createElement('div', { className: 'facelift-card' },
            React.createElement('div', { className: 'facelift-section-header' },
              React.createElement('h2', { className: 'facelift-section-title' },
                React.createElement('span', { className: 'facelift-section-title-icon' }, '⏮️'),
                'Recently Played'
              )
            ),
            recentlyPlayed.length > 0
              ? React.createElement('div', { className: 'facelift-recently-played-carousel' },
                  recentlyPlayed.map(scene =>
                    React.createElement(SceneCard, { key: scene.id + '_rp', scene: scene, onNavigate: navigateToUrl })
                  )
                )
              : React.createElement('div', { className: 'facelift-empty-state' },
                  React.createElement('div', { className: 'facelift-empty-text' }, 'No recently played scenes.')
                )
          ),

          // Random Image Spotlight
          React.createElement('div', { className: 'facelift-card' },
            React.createElement('div', { className: 'facelift-section-header' },
              React.createElement('h2', { className: 'facelift-section-title' },
                React.createElement('span', { className: 'facelift-section-title-icon' }, '🖼️'),
                'Random Image Spotlight'
              ),
              React.createElement('div', { className: 'facelift-controls-group' },
                !isMobile && selectedImageIds.length > 0 && React.createElement(React.Fragment, null,
                  React.createElement('button', {
                    className: 'facelift-btn-classic-toggle accent',
                    onClick: openCanvas,
                    style: { borderColor: 'var(--fl-secondary)', color: '#fff', background: 'rgba(6, 182, 212, 0.1)' }
                  }, `✨ Open Canvas (${selectedImageIds.length})`),
                  React.createElement('button', {
                    className: 'facelift-btn-classic-toggle',
                    onClick: clearImageSelection
                  }, '✕ Clear')
                ),
                React.createElement('button', { className: 'facelift-btn-refresh', onClick: fetchGalleryImages, disabled: loadingGallery },
                  React.createElement('span', { className: 'facelift-btn-refresh-icon' }, '🔄'),
                  ' Refresh Gallery'
                )
              )
            ),
            loadingGallery
              ? React.createElement('div', { className: 'facelift-empty-state' },
                  React.createElement('span', { className: 'facelift-spinner' })
                )
              : visibleImages.length > 0
                ? React.createElement('div', null,
                    React.createElement('div', { className: 'facelift-gallery-grid' },
                      visibleImages.map((img, index) => {
                        const isSelected = selectedImageIds.includes(img.id);
                        return React.createElement('div', {
                          key: img.id,
                          className: `facelift-image-card ${!isMobile && isSelected ? 'selected' : ''}`,
                          onClick: () => setActiveLightboxIndex(index)
                        },
                          !isMobile && React.createElement('div', {
                            className: 'facelift-image-card-checkbox-wrapper',
                            onClick: (e) => {
                              e.stopPropagation();
                              toggleImageSelection(img.id);
                            }
                          },
                            React.createElement('div', {
                              className: `facelift-image-card-checkbox ${isSelected ? 'checked' : ''}`
                            }, isSelected ? '✓' : '')
                          ),
                          React.createElement('div', { className: 'facelift-image-card-media' },
                            React.createElement('img', {
                              src: img?.paths?.thumbnail || img?.paths?.image || '',
                              alt: img.title || `Image ${img.id}`,
                              loading: 'lazy'
                            }),
                            React.createElement('div', { className: 'facelift-image-card-hover-overlay' },
                              React.createElement('span', { className: 'facelift-image-card-search-icon' }, '🔍')
                            )
                          ),
                          React.createElement('div', { className: 'facelift-image-card-footer' },
                            React.createElement('span', { className: 'facelift-image-card-title', title: img.title || `Image ${img.id}` },
                              img.title || `Image ${img.id}`
                            )
                          )
                        );
                      })
                    ),
                    React.createElement('div', { className: 'facelift-showmore-container', style: { marginTop: '1.25rem' } },
                      React.createElement('button', {
                        className: 'facelift-btn-showmore',
                        onClick: loadMoreGalleryImages,
                        disabled: loadingMoreGallery
                      }, loadingMoreGallery ? 'Loading...' : 'Load More Photos')
                    )
                  )
                : React.createElement('div', { className: 'facelift-empty-state' },
                    React.createElement('div', { className: 'facelift-empty-text' }, 'No images found in your library.')
                  )
          ),

        ),

        // B. Right Column Stack: Mood Board + Marker Spotlight
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 } },
          React.createElement('div', { className: 'facelift-card facelift-mood-board' },
            React.createElement('div', { className: 'facelift-section-header' },
              React.createElement('h2', { className: 'facelift-section-title' },
                React.createElement('span', { className: 'facelift-section-title-icon' }, '🎭'),
                'Mood Board'
              )
            ),
            topTags.length > 0 && React.createElement('div', { className: 'facelift-mood-selectors' },
              topTags.map(tag =>
                React.createElement('span', {
                  key: tag.id,
                  className: `facelift-mood-chip ${selectedMood && selectedMood.id === tag.id ? 'active' : ''}`,
                  onClick: () => setSelectedMood(tag)
                }, tag.name)
              )
            ),
            loadingMood
              ? React.createElement('div', { className: 'facelift-empty-state' },
                  React.createElement('span', { className: 'facelift-spinner' })
                )
              : moodScenes.length > 0
                ? React.createElement('div', { className: 'facelift-mood-carousel' },
                    moodScenes.slice(0, 10).map(scene =>
                      React.createElement(SceneCard, { key: scene.id + '_mood', scene: scene, onNavigate: navigateToUrl })
                    )
                  )
                : React.createElement('div', { className: 'facelift-empty-state' },
                    React.createElement('div', { className: 'facelift-empty-text' }, 'Select a mood to generate a playlist.')
                  )
          ),
          React.createElement(MarkerSpotlight, { onNavigate: navigateToUrl })
        )
      ),

      // 5. LIGHTBOX OVERLAY
      renderLightbox(),

      // 6. COLLAGE CANVAS OVERLAY
      !isMobile && isCanvasOpen && React.createElement(CanvasWorkspace, {
        windows: canvasWindows,
        setWindows: setCanvasWindows,
        onClose: () => setIsCanvasOpen(false)
      })
    )
  );
  };

  // --- SHORTS FEED VIEW COMPONENT ---
  const ShortsFeed = ({ onNavigate }) => {
    const [scenes, setScenes] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [isMuted, setIsMuted] = useState(true);
    const [isPlaying, setIsPlaying] = useState(true);
    const [liked, setLiked] = useState(false);
    const [toast, setToast] = useState({ active: false, icon: '🔇' });
    const [videoRatio, setVideoRatio] = useState(null);
    const videoRef = useRef(null);

    const touchStartRef = useRef(0);
    const handleTouchStart = (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        touchStartRef.current = e.changedTouches[0].clientY;
      }
    };
    const handleTouchEnd = (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const touchEnd = e.changedTouches[0].clientY;
        const deltaY = touchEnd - touchStartRef.current;
        if (deltaY > 50) {
          handlePrev();
        } else if (deltaY < -50) {
          handleNext();
        }
      }
    };

    // SVGs for custom controls
    const svgPlay = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M8 5v14l11-7z' })
    );
    const svgPause = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' })
    );
    const svgNext = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z' })
    );
    const svgPrev = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M6 6h2v12H6zm3.5 6l8.5 6V6z' })
    );
    const svgVolume = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z' })
    );
    const svgMute = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z' })
    );
    const svgLoop = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z' })
    );
    const svgFullscreen = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor' },
      React.createElement('path', { d: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z' })
    );
    const svgHeartLiked = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor', style: { color: 'var(--fl-accent)' } },
      React.createElement('path', { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' })
    );
    const svgHeartUnliked = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', strokeWidth: '2' },
      React.createElement('path', { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' })
    );
    const svgOpenFull = React.createElement('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('line', { x1: '7', y1: '17', x2: '17', y2: '7' }),
      React.createElement('polyline', { points: '7 7 17 7 17 17' })
    );

    // States for custom video player
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isLooping, setIsLooping] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isDraggingProgress, setIsDraggingProgress] = useState(false);

    // Time Formatter
    const formatTime = (secs) => {
      if (isNaN(secs) || secs < 0) return '0:00';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const sStr = String(s).padStart(2, '0');
      if (h > 0) {
        const mStr = String(m).padStart(2, '0');
        return `${h}:${mStr}:${sStr}`;
      }
      return `${m}:${sStr}`;
    };

    // Fullscreen listener
    useEffect(() => {
      const handleFsChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFsChange);
      return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

    // Pointer-events drag logic for timeline
    const handlePointerDown = (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDraggingProgress(true);
      seek(e);
    };

    const handlePointerMove = (e) => {
      if (isDraggingProgress) {
        seek(e);
      }
    };

    const handlePointerUp = (e) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDraggingProgress(false);
    };

    const seek = (e) => {
      const video = videoRef.current;
      if (!video || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const pct = Math.max(0, Math.min(1, clickX / width));
      video.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    };

    const handlePlayPause = () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    const handleSpeedClick = () => {
      const video = videoRef.current;
      if (!video) return;
      let nextRate = 1;
      if (playbackRate === 1) nextRate = 1.25;
      else if (playbackRate === 1.25) nextRate = 1.5;
      else if (playbackRate === 1.5) nextRate = 2;
      else nextRate = 1;
      video.playbackRate = nextRate;
    };

    const handleLoopToggle = () => {
      setIsLooping(prev => !prev);
    };

    const handleFullscreenToggle = () => {
      const player = document.querySelector('.facelift-shorts-player');
      if (!player) return;
      if (!document.fullscreenElement) {
        player.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    };

    const currentScene = scenes[currentIndex];
    const playAccumulatorRef = useRef(0);
    const trackedRef = useRef(false);

    useEffect(() => {
      playAccumulatorRef.current = 0;
      trackedRef.current = false;
    }, [currentIndex]);

    // --- WATCH TIME TRACKING FOR SHORTS ---
    useEffect(() => {
      let timer = null;
      let lastTime = -1;

      const tick = () => {
        const video = videoRef.current;
        if (video && !video.paused && !video.ended && document.visibilityState !== 'hidden') {
          const currentTime = video.currentTime;
          if (lastTime !== -1 && currentTime !== lastTime) {
            const diff = currentTime - lastTime;
            // Accumulate playback progress; filter out loops/jumps (scrubbing)
            if (diff > 0 && diff < 2.5) {
              const todayStr = getLocalDateString(new Date());
              const store = JSON.parse(localStorage.getItem('facelift-shorts-watchtime') || '{}');
              store[todayStr] = (store[todayStr] || 0) + diff;
              localStorage.setItem('facelift-shorts-watchtime', JSON.stringify(store));

              if (currentScene) {
                playAccumulatorRef.current += diff;
                if (playAccumulatorRef.current >= 60 && !trackedRef.current) {
                  trackedRef.current = true;
                  console.log(`[Facelift] Scene ${currentScene.id} played for > 1 minute in shorts. Tracking to watch history.`);
                  const nowISO = new Date().toISOString();
                  graphqlRequest(`
                    mutation AddShortsPlay($id: ID!, $times: [Timestamp!]) {
                      sceneAddPlay(id: $id, times: $times) {
                        count
                        history
                      }
                    }
                  `, { id: currentScene.id, times: [nowISO] }).then(res => {
                    if (res) {
                      console.log(`[Facelift] Successfully recorded play in watch history for scene ${currentScene.id}`);
                    }
                  });
                }
              }
            }
          }
          lastTime = currentTime;
        } else {
          lastTime = -1;
        }
      };

      timer = setInterval(tick, 500);

      return () => {
        if (timer) clearInterval(timer);
      };
    }, [currentIndex, currentScene]);

    const fetchShorts = async () => {
      setLoading(true);
      const query = `
        query FindShorts {
          findScenes(filter: { per_page: 30, sort: "random" }) {
            scenes {
              id
              title
              stash_ids {
                stash_id
              }
              tags {
                id
              }
              paths {
                screenshot
                preview
                stream
              }
              files {
                duration
                basename
              }
              studio {
                name
              }
              performers {
                id
                name
              }
            }
          }
        }
      `;
      const data = await graphqlRequest(query);
      if (data && data.findScenes) {
        const valid = data.findScenes.scenes.filter(s => s?.paths?.stream);
        if (valid.length > 0) {
          setScenes(prev => {
            const existingIds = new Set(prev.map(s => s.id));
            const newScenes = valid.filter(s => !existingIds.has(s.id));
            return [...prev, ...newScenes];
          });
        }
      }
      setLoading(false);
    };

    useEffect(() => {
      fetchShorts();
    }, []);
    useEffect(() => {
      if (!currentScene) return;
      const likedIds = JSON.parse(localStorage.getItem('facelift-liked-shorts') || '[]');
      setLiked(likedIds.includes(currentScene.id));
    }, [currentScene]);

    const toggleLike = () => {
      if (!currentScene) return;
      const likedIds = JSON.parse(localStorage.getItem('facelift-liked-shorts') || '[]');
      let updated;
      if (likedIds.includes(currentScene.id)) {
        updated = likedIds.filter(id => id !== currentScene.id);
        setLiked(false);
      } else {
        updated = [...likedIds, currentScene.id];
        setLiked(true);
      }
      localStorage.setItem('facelift-liked-shorts', JSON.stringify(updated));
    };

    useEffect(() => {
      if (videoRef.current) {
        videoRef.current.muted = isMuted;
        if (isPlaying) {
          videoRef.current.play().catch(() => {});
        } else {
          videoRef.current.pause();
        }
      }
    }, [isMuted, isPlaying, currentIndex, currentScene]);

    useEffect(() => {
      setIsPlaying(true);
      setVideoRatio(null);
    }, [currentIndex]);

    const handleNext = () => {
      if (currentIndex < scenes.length - 1) {
        setCurrentIndex(prev => prev + 1);
      }
      if (currentIndex >= scenes.length - 5) {
        fetchShorts();
      }
    };

    const handlePrev = () => {
      if (currentIndex > 0) {
        setCurrentIndex(prev => prev - 1);
      }
    };

    const togglePlay = () => {
      setIsPlaying(prev => {
        const next = !prev;
        showToast(next ? '▶️' : '⏸️');
        return next;
      });
    };

    const toggleMute = () => {
      setIsMuted(prev => {
        const next = !prev;
        showToast(next ? '🔊' : '🔇');
        return next;
      });
    };

    const showToast = (icon) => {
      setToast({ active: true, icon });
      setTimeout(() => {
        setToast(prev => ({ ...prev, active: false }));
      }, 800);
    };

    const handleLoadedMetadata = (e) => {
      const v = e.target;
      if (v.videoWidth && v.videoHeight) {
        setVideoRatio(`${v.videoWidth} / ${v.videoHeight}`);
      }
      const dur = v.duration || (currentScene?.files && currentScene.files[0] ? currentScene.files[0].duration : 0);
      setDuration(dur);
      if (dur > 0) {
        v.currentTime = dur * 0.25;
      }
    };

    useEffect(() => {
      const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          handleNext();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          handlePrev();
        } else if (e.key === ' ') {
          e.preventDefault();
          togglePlay();
        } else if (e.key.toLowerCase() === 'm') {
          e.preventDefault();
          toggleMute();
        } else if (e.key === 'Enter' || e.key.toLowerCase() === 'f') {
          e.preventDefault();
          if (currentScene) {
            const seekTime = videoRef.current ? Math.floor(videoRef.current.currentTime) : 0;
            window.open(`/scenes/${currentScene.id}?t=${seekTime}`, '_blank');
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [currentIndex, scenes, isMuted, isPlaying]);

    useEffect(() => {
      let lastWheelTime = 0;
      const handleWheel = (e) => {
        const now = Date.now();
        if (now - lastWheelTime < 800) {
          e.preventDefault();
          return;
        }
        if (Math.abs(e.deltaY) > 10) {
          lastWheelTime = now;
          e.preventDefault();
          if (e.deltaY > 0) {
            handleNext();
          } else {
            handlePrev();
          }
        }
      };

      window.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        window.removeEventListener('wheel', handleWheel);
      };
    }, [currentIndex, scenes]);

    if (loading && scenes.length === 0) {
      return React.createElement('div', { className: 'facelift-shorts-container' },
        React.createElement('div', { className: 'facelift-loader-container' },
          React.createElement('span', { className: 'facelift-spinner' }),
          React.createElement('h3', null, 'Loading Shorts...'),
          React.createElement('p', null, 'Assembling your quick previews playlist')
        )
      );
    }

    if (scenes.length === 0) {
      return React.createElement('div', { className: 'facelift-shorts-container' },
        React.createElement('div', { className: 'facelift-card facelift-empty-state' },
          React.createElement('div', { className: 'facelift-empty-icon' }, '🎞️'),
          React.createElement('div', { className: 'facelift-empty-text' }, 'No scene previews found in your Stash library! Please make sure previews are generated.')
        )
      );
    }

    const performerTags = currentScene.performers && currentScene.performers.map(p =>
      React.createElement('span', { key: p.id, className: 'facelift-shorts-performer-tag' }, p.name)
    );

    // Dynamic Title Selection: filename fallback for uncategorized/unmatched scenes
    const hasStashId = currentScene.stash_ids && currentScene.stash_ids.length > 0;
    const hasStudio = !!currentScene.studio;
    const hasTags = currentScene.tags && currentScene.tags.length > 0;
    const isCategorized = hasStudio || hasTags;

    let displayTitle = currentScene.title || '';
    if (!displayTitle || displayTitle.toLowerCase() === 'untitled scene') {
      if (!hasStashId && !isCategorized) {
        displayTitle = currentScene.files?.[0]?.basename || 'Untitled Scene';
      } else {
        displayTitle = 'Untitled Scene';
      }
    }

    return React.createElement('div', {
      className: 'facelift-shorts-container',
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd
    },
      React.createElement('div', { className: `facelift-shorts-state-toast ${toast.active ? 'active' : ''}` }, toast.icon),
      React.createElement('div', {
        className: 'facelift-shorts-player',
        style: { aspectRatio: videoRatio || '16/9' }
      },
        React.createElement('video', {
          ref: videoRef,
          src: currentScene?.paths?.stream || '',
          className: 'facelift-shorts-video',
          loop: isLooping,
          muted: isMuted,
          playsInline: true,
          controls: false,
          onPlay: () => setIsPlaying(true),
          onPause: () => setIsPlaying(false),
          onTimeUpdate: (e) => setCurrentTime(e.target.currentTime),
          onDurationChange: (e) => setDuration(e.target.duration),
          onLoadedMetadata: handleLoadedMetadata,
          onRateChange: (e) => setPlaybackRate(e.target.playbackRate)
        }),
        React.createElement('div', { className: 'facelift-shorts-controls' },
          React.createElement('div', {
            className: 'facelift-shorts-progress',
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp
          },
            React.createElement('div', { className: 'facelift-shorts-progress-track' },
              React.createElement('div', {
                className: 'facelift-shorts-progress-fill',
                style: { width: `${(currentTime / (duration || 1)) * 100}%` }
              })
            )
          ),
          React.createElement('div', { className: 'facelift-shorts-buttons' },
            React.createElement('div', { className: 'facelift-shorts-buttons-left' },
              React.createElement('button', {
                className: 'facelift-shorts-control-btn',
                onClick: handlePlayPause,
                title: isPlaying ? 'Pause' : 'Play'
              }, isPlaying ? svgPause : svgPlay),
              React.createElement('button', {
                className: 'facelift-shorts-control-btn',
                onClick: handlePrev,
                title: 'Previous Short'
              }, svgPrev),
              React.createElement('button', {
                className: 'facelift-shorts-control-btn',
                onClick: handleNext,
                title: 'Next Short'
              }, svgNext),
              React.createElement('button', {
                className: 'facelift-shorts-control-btn',
                onClick: toggleMute,
                title: isMuted ? 'Unmute' : 'Mute'
              }, isMuted ? svgMute : svgVolume),
              React.createElement('span', { className: 'facelift-shorts-time-display' },
                `${formatTime(currentTime)} / ${formatTime(duration)}`
              )
            ),
            React.createElement('div', { className: 'facelift-shorts-buttons-right' },
              React.createElement('button', {
                className: `facelift-shorts-control-btn ${liked ? 'active' : ''}`,
                onClick: toggleLike,
                title: liked ? 'Unlike' : 'Like'
              }, liked ? svgHeartLiked : svgHeartUnliked),
              React.createElement('a', {
                href: `/scenes/${currentScene.id}`,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'facelift-shorts-control-btn',
                title: 'Watch Full Scene',
                onMouseDown: (e) => {
                  const seekTime = videoRef.current ? Math.floor(videoRef.current.currentTime) : 0;
                  e.currentTarget.href = `/scenes/${currentScene.id}?t=${seekTime}`;
                }
              }, svgOpenFull),
              React.createElement('button', {
                className: 'facelift-shorts-speed-btn',
                onClick: handleSpeedClick,
                title: 'Playback Speed'
              }, `${playbackRate}x`),
              React.createElement('button', {
                className: `facelift-shorts-control-btn ${isLooping ? 'active' : ''}`,
                onClick: handleLoopToggle,
                title: 'Toggle Loop'
              }, svgLoop),
              React.createElement('button', {
                className: 'facelift-shorts-control-btn',
                onClick: handleFullscreenToggle,
                title: 'Toggle Fullscreen'
              }, svgFullscreen)
            )
          )
        ),
        React.createElement('div', { className: 'facelift-shorts-info-bottom' },
          React.createElement('h3', { className: 'facelift-shorts-title' }, displayTitle),
          currentScene.studio && React.createElement('span', { className: 'facelift-shorts-studio' }, currentScene.studio.name),
          performerTags && performerTags.length > 0 && React.createElement('div', { className: 'facelift-shorts-performers' }, performerTags)
        )
      )
    );
  };

  // --- CALENDAR WIDGET COMPONENT ---
  const CalendarWidget = ({ selectedDate, onSelectDate, playCountsByDate }) => {
    const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
    const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());

    useEffect(() => {
      if (selectedDate) {
        const [y, m] = selectedDate.split('-').map(Number);
        setCurrentYear(y);
        setCurrentMonth(m - 1);
      }
    }, [selectedDate]);

    const handlePrevMonth = () => {
      setCurrentMonth(prev => {
        if (prev === 0) {
          setCurrentYear(y => y - 1);
          return 11;
        }
        return prev - 1;
      });
    };

    const handleNextMonth = () => {
      setCurrentMonth(prev => {
        if (prev === 11) {
          setCurrentYear(y => y + 1);
          return 0;
        }
        return prev + 1;
      });
    };

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const daysGrid = useMemo(() => {
      const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
      const numDays = new Date(currentYear, currentMonth + 1, 0).getDate();
      const prevNumDays = new Date(currentYear, currentMonth, 0).getDate();

      const grid = [];

      for (let i = firstDayIndex - 1; i >= 0; i--) {
        const d = prevNumDays - i;
        const prevMonthIdx = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYearVal = currentMonth === 0 ? currentYear - 1 : currentYear;
        const dateStr = `${prevYearVal}-${String(prevMonthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        grid.push({ day: d, isCurrentMonth: false, dateStr });
      }

      for (let d = 1; d <= numDays; d++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        grid.push({ day: d, isCurrentMonth: true, dateStr });
      }

      const totalCells = Math.ceil(grid.length / 7) * 7;
      const nextMonthPadding = totalCells - grid.length;
      for (let d = 1; d <= nextMonthPadding; d++) {
        const nextMonthIdx = currentMonth === 11 ? 0 : currentMonth + 1;
        const nextYearVal = currentMonth === 11 ? currentYear + 1 : currentYear;
        const dateStr = `${nextYearVal}-${String(nextMonthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        grid.push({ day: d, isCurrentMonth: false, dateStr });
      }

      return grid;
    }, [currentYear, currentMonth]);

    return React.createElement('div', { className: 'facelift-card facelift-trends-calendar-card' },
      React.createElement('div', { className: 'facelift-trends-calendar-header' },
        React.createElement('button', { className: 'facelift-btn-calendar-nav', onClick: handlePrevMonth }, '‹'),
        React.createElement('span', { className: 'facelift-trends-calendar-month-year' }, `${monthNames[currentMonth]} ${currentYear}`),
        React.createElement('button', { className: 'facelift-btn-calendar-nav', onClick: handleNextMonth }, '›')
      ),
      React.createElement('div', { className: 'facelift-trends-calendar-weekdays' },
        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((wd, i) =>
          React.createElement('span', { key: i, className: 'facelift-trends-calendar-weekday' }, wd)
        )
      ),
      React.createElement('div', { className: 'facelift-trends-calendar-days' },
        daysGrid.map(({ day, isCurrentMonth, dateStr }) => {
          const playsCount = playCountsByDate[dateStr] || 0;
          const isSelected = dateStr === selectedDate;
          return React.createElement('button', {
            key: dateStr,
            className: `facelift-trends-calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isSelected ? 'active' : ''} ${playsCount > 0 ? 'has-activity' : ''}`,
            onClick: () => onSelectDate(dateStr),
            title: `${dateStr}${playsCount > 0 ? ` (${playsCount} plays)` : ''}`
          },
            React.createElement('span', { className: 'facelift-trends-calendar-day-number' }, day),
            playsCount > 0 && React.createElement('span', { className: 'facelift-trends-calendar-day-dot' })
          );
        })
      )
    );
  };

  // --- DAILY TRENDS COMPONENT ---
  const DailyTrends = ({ playedScenes, onNavigate }) => {
    const [selectedDate, setSelectedDate] = useState(() => getLocalDateString(new Date()));
    const [visiblePerformersCount, setVisiblePerformersCount] = useState(5);
    const [visibleTagsCount, setVisibleTagsCount] = useState(10);
    const [visibleScenesCount, setVisibleScenesCount] = useState(10);

    useEffect(() => {
      setVisiblePerformersCount(5);
      setVisibleTagsCount(10);
      setVisibleScenesCount(10);
    }, [selectedDate]);

    const playCountsByDate = useMemo(() => {
      const counts = {};
      playedScenes.forEach(scene => {
        if (scene.play_history) {
          scene.play_history.forEach(ts => {
            const dateObj = new Date(ts);
            const dateStr = getLocalDateString(dateObj);
            counts[dateStr] = (counts[dateStr] || 0) + 1;
          });
        }
      });
      return counts;
    }, [playedScenes]);

    const setToday = () => setSelectedDate(getLocalDateString(new Date()));
    const setYesterday = () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      setSelectedDate(getLocalDateString(d));
    };

    const trendsData = useMemo(() => {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const targetDateStart = new Date(year, month - 1, day, 0, 0, 0, 0);
      const targetDateEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
      const startTime = targetDateStart.getTime();
      const endTime = targetDateEnd.getTime();

      let totalWatchTime = getDeduplicatedWatchTime(playedScenes, startTime, endTime);
      let totalPlaysOnDay = 0;
      const timestamps = [];
      const scenesList = [];
      
      const performerStats = {};
      const tagStats = {};

      playedScenes.forEach(scene => {
        if (!scene.play_history) return;
        
        const playsOnDay = scene.play_history.filter(ts => {
          const playTime = new Date(ts).getTime();
          const matches = playTime >= startTime && playTime <= endTime;
          if (matches) {
            timestamps.push(playTime);
          }
          return matches;
        }).length;

        if (playsOnDay > 0) {
          const sceneDuration = scene.play_duration || (scene.files && scene.files[0] ? scene.files[0].duration : 0);
          const averagePlayDuration = (sceneDuration || 0) / (scene.play_count || 1);
          const watchTimeOnDay = playsOnDay * averagePlayDuration;

          totalPlaysOnDay += playsOnDay;

          scenesList.push({
            scene,
            watchTime: watchTimeOnDay,
            plays: playsOnDay,
            duration: sceneDuration
          });

          if (scene.performers) {
            scene.performers.forEach(p => {
              if (!performerStats[p.id]) {
                performerStats[p.id] = { name: p.name, image_path: p.image_path, watchTime: 0, plays: 0 };
              }
              performerStats[p.id].watchTime += watchTimeOnDay;
              performerStats[p.id].plays += playsOnDay;
            });
          }

          if (scene.tags) {
            scene.tags.forEach(t => {
              if (!tagStats[t.id]) {
                tagStats[t.id] = { name: t.name, image_path: t.image_path, watchTime: 0, plays: 0 };
              }
              tagStats[t.id].watchTime += watchTimeOnDay;
              tagStats[t.id].plays += playsOnDay;
            });
          }
        }
      });

      timestamps.sort((a, b) => a - b);
      let sessionCount = 0;
      if (timestamps.length > 0) {
        sessionCount = 1;
        const gapLimit = 15 * 60 * 1000;
        for (let i = 1; i < timestamps.length; i++) {
          if (timestamps[i] - timestamps[i - 1] > gapLimit) {
            sessionCount++;
          }
        }
      }

      const sortedPerformers = Object.entries(performerStats)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.watchTime - a.watchTime);

      const sortedTags = Object.entries(tagStats)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.watchTime - a.watchTime);

      const sortedScenes = scenesList.sort((a, b) => b.watchTime - a.watchTime);

      const shortsWatchTime = getShortsWatchTimeForRange(startTime, endTime);
      const combinedWatchTime = totalWatchTime + shortsWatchTime;

      return {
        totalWatchTime: combinedWatchTime,
        shortsWatchTime,
        sceneWatchTime: totalWatchTime,
        totalPlaysOnDay,
        uniqueScenesCount: scenesList.length,
        sessionCount,
        performers: sortedPerformers,
        tags: sortedTags,
        scenes: sortedScenes
      };
    }, [playedScenes, selectedDate]);

    const topTag = trendsData.tags[0];

    return React.createElement('div', { className: 'facelift-trends-container' },
      React.createElement('div', { className: 'facelift-trends-header' },
        React.createElement('h2', { className: 'facelift-section-title' },
          React.createElement('span', { className: 'facelift-section-title-icon' }, '📊'),
          'Daily Viewer Trends'
        ),
        React.createElement('div', { className: 'facelift-controls-group' },
          React.createElement('button', {
            className: 'facelift-btn-classic-toggle',
            onClick: setYesterday
          }, '⏮️ Yesterday'),
          React.createElement('button', {
            className: 'facelift-btn-classic-toggle',
            onClick: setToday
          }, '📅 Today'),
          React.createElement('input', {
            type: 'date',
            className: 'facelift-date-input',
            value: selectedDate,
            onChange: (e) => setSelectedDate(e.target.value)
          })
        )
      ),

      React.createElement('div', { className: 'facelift-trends-layout' },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 } },
          React.createElement('div', { className: 'facelift-stats-row' },
            React.createElement('div', { className: 'facelift-stat-card' },
              React.createElement('span', { className: 'facelift-stat-icon' }, '⏱️'),
              React.createElement('div', { className: 'facelift-stat-details' },
                React.createElement('span', { className: 'facelift-stat-value' }, `${(trendsData.totalWatchTime / 3600).toFixed(1)} hrs`),
                React.createElement('span', { className: 'facelift-stat-label' }, 'Total Hours')
              )
            ),
            React.createElement('div', { className: 'facelift-stat-card' },
              React.createElement('span', { className: 'facelift-stat-icon' }, '⏳'),
              React.createElement('div', { className: 'facelift-stat-details' },
                React.createElement('span', { className: 'facelift-stat-value' }, `${Math.round(trendsData.totalWatchTime / 60)} mins`),
                React.createElement('span', { className: 'facelift-stat-label' }, 'Total Minutes')
              )
            ),
            React.createElement('div', { className: 'facelift-stat-card' },
              React.createElement('span', { className: 'facelift-stat-icon' }, '🌀'),
              React.createElement('div', { className: 'facelift-stat-details' },
                React.createElement('span', { className: 'facelift-stat-value' }, `${Math.round(trendsData.shortsWatchTime / 60)} mins`),
                React.createElement('span', { className: 'facelift-stat-label' }, 'Shorts Time')
              )
            ),
            React.createElement('div', { className: 'facelift-stat-card' },
              React.createElement('span', { className: 'facelift-stat-icon' }, '📺'),
              React.createElement('div', { className: 'facelift-stat-details' },
                React.createElement('span', { className: 'facelift-stat-value' }, trendsData.sessionCount),
                React.createElement('span', { className: 'facelift-stat-label' }, 'Sessions')
              )
            ),
            React.createElement('div', { className: 'facelift-stat-card' },
              React.createElement('span', { className: 'facelift-stat-icon' }, '🎬'),
              React.createElement('div', { className: 'facelift-stat-details' },
                React.createElement('span', { className: 'facelift-stat-value' }, trendsData.uniqueScenesCount),
                React.createElement('span', { className: 'facelift-stat-label' }, 'Unique Scenes')
              )
            )
          ),

          trendsData.uniqueScenesCount === 0
            ? React.createElement('div', { className: 'facelift-card facelift-empty-state' },
                React.createElement('div', { className: 'facelift-empty-icon' }, '📭'),
                React.createElement('div', { className: 'facelift-empty-text' }, `No activity recorded for ${selectedDate}. Select a highlighted day on the calendar to view trends.`)
              )
            : React.createElement('div', { className: 'facelift-trends-grid' },
                topTag && React.createElement('a', {
                  href: `/tags/${topTag.id}`,
                  className: 'facelift-trends-top-tag-banner first-place',
                  onClick: (e) => handleLinkClick(e, `/tags/${topTag.id}`, onNavigate)
                },
                  React.createElement('div', { className: 'facelift-trends-top-tag-banner-media' },
                    topTag.image_path
                      ? React.createElement('img', { src: topTag.image_path, alt: topTag.name, loading: 'lazy' })
                      : React.createElement('div', { className: 'facelift-trends-top-tag-banner-placeholder' }, '🏷️')
                  ),
                  React.createElement('div', { className: 'facelift-trends-top-tag-banner-content' },
                    React.createElement('span', { className: 'facelift-trends-top-tag-badge' }, '🏆 TOP TAG OF THE DAY'),
                    React.createElement('h3', { className: 'facelift-trends-top-tag-name' }, topTag.name),
                    React.createElement('div', { className: 'facelift-trends-top-tag-stats' },
                      React.createElement('span', null, `Watch Time: ${formatDuration(topTag.watchTime)}`),
                      React.createElement('span', null, `Playbacks: ${topTag.plays} play${topTag.plays > 1 ? 's' : ''}`)
                    )
                  )
                ),

                React.createElement('div', { className: 'facelift-trends-section' },
                  React.createElement('h3', { className: 'facelift-trends-section-title' },
                    React.createElement('span', null, '💃'),
                    'Top Performers'
                  ),
                  trendsData.performers.length > 0
                    ? React.createElement('div', null,
                        React.createElement('div', { className: 'facelift-trends-performers-grid' },
                          trendsData.performers.slice(0, visiblePerformersCount).map((perf, index) => {
                            const sharePct = trendsData.totalWatchTime > 0 ? (perf.watchTime / trendsData.totalWatchTime) * 100 : 0;
                            return React.createElement('a', {
                              key: perf.id,
                              href: `/performers/${perf.id}`,
                              className: `facelift-trends-performer-card ${index === 0 ? 'first-place' : ''}`,
                              onClick: (e) => handleLinkClick(e, `/performers/${perf.id}`, onNavigate)
                            },
                              React.createElement('div', { className: 'facelift-trends-performer-image-container' },
                                perf.image_path
                                  ? React.createElement('img', {
                                      src: perf.image_path,
                                      className: 'facelift-trends-performer-image',
                                      alt: perf.name,
                                      loading: 'lazy'
                                    })
                                  : React.createElement('div', { className: 'facelift-trends-performer-placeholder' }, '💃')
                              ),
                              React.createElement('div', { className: 'facelift-trends-performer-info', style: { padding: '0.75rem 1rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
                                React.createElement('div', { className: 'facelift-trends-performer-header' },
                                  React.createElement('span', { className: 'facelift-trends-performer-name' }, perf.name),
                                  React.createElement('span', { style: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--fl-secondary)' } }, `${sharePct.toFixed(1)}%`)
                                ),
                                React.createElement('div', { className: 'facelift-trends-performer-stats' },
                                  React.createElement('span', null, formatDuration(perf.watchTime)),
                                  React.createElement('span', null, `${perf.plays} play${perf.plays > 1 ? 's' : ''}`)
                                ),
                                React.createElement('div', { className: 'facelift-trends-progress-bar-bg' },
                                  React.createElement('div', {
                                    className: 'facelift-trends-progress-bar-fill',
                                    style: { width: `${Math.min(100, sharePct)}%` }
                                  })
                                )
                              )
                            );
                          })
                        ),
                        trendsData.performers.length > 5 && React.createElement('div', { className: 'facelift-showmore-container', style: { marginTop: '0.75rem' } },
                          React.createElement('button', {
                            className: 'facelift-btn-showmore',
                            onClick: () => setVisiblePerformersCount(prev => prev === 5 ? trendsData.performers.length : 5)
                          }, visiblePerformersCount === 5 ? `Load More (+${trendsData.performers.length - 5})` : 'Show Less')
                        )
                      )
                    : React.createElement('div', { className: 'facelift-empty-state', style: { padding: '1rem' } },
                        React.createElement('div', { className: 'facelift-empty-text' }, 'No performer tags recorded for this day\'s scenes.')
                      )
                ),

                React.createElement('div', { className: 'facelift-trends-section' },
                  React.createElement('h3', { className: 'facelift-trends-section-title' },
                    React.createElement('span', null, '🏷️'),
                    'Top Tags'
                  ),
                  trendsData.tags.length > 0
                    ? React.createElement('div', null,
                        React.createElement('div', { className: 'facelift-trends-tags-grid' },
                          trendsData.tags.slice(0, visibleTagsCount).map((tag, index) => {
                            return React.createElement('a', {
                              key: tag.id,
                              href: `/tags/${tag.id}`,
                              className: `facelift-trends-tag-card ${index === 0 ? 'first-place' : ''}`,
                              onClick: (e) => handleLinkClick(e, `/tags/${tag.id}`, onNavigate)
                            },
                              React.createElement('div', { className: 'facelift-trends-tag-image-container' },
                                tag.image_path
                                  ? React.createElement('img', {
                                      src: tag.image_path,
                                      className: 'facelift-trends-tag-image',
                                      alt: tag.name,
                                      loading: 'lazy'
                                    })
                                  : React.createElement('div', { className: 'facelift-trends-tag-placeholder' }, '🏷️')
                              ),
                              React.createElement('div', { className: 'facelift-trends-tag-info', style: { padding: '0.6rem 0.75rem 0.75rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
                                React.createElement('span', { className: 'facelift-trends-tag-name' }, tag.name),
                                React.createElement('div', { className: 'facelift-trends-tag-stats' },
                                  React.createElement('span', null, formatDuration(tag.watchTime)),
                                  React.createElement('span', null, `${tag.plays} play${tag.plays > 1 ? 's' : ''}`)
                                )
                              )
                            );
                          })
                        ),
                        trendsData.tags.length > 10 && React.createElement('div', { className: 'facelift-showmore-container', style: { marginTop: '0.75rem' } },
                          React.createElement('button', {
                            className: 'facelift-btn-showmore',
                            onClick: () => setVisibleTagsCount(prev => prev === 10 ? trendsData.tags.length : 10)
                          }, visibleTagsCount === 10 ? `Load More (+${trendsData.tags.length - 10})` : 'Show Less')
                        )
                      )
                    : React.createElement('div', { className: 'facelift-empty-state', style: { padding: '1rem' } },
                        React.createElement('div', { className: 'facelift-empty-text' }, 'No tags recorded for this day\'s scenes.')
                      )
                ),

                React.createElement('div', { className: 'facelift-trends-section' },
                  React.createElement('h3', { className: 'facelift-trends-section-title' },
                    React.createElement('span', null, '🎬'),
                    'Scenes Watched'
                  ),
                  React.createElement('div', { className: 'facelift-trends-scenes-list' },
                    trendsData.scenes.slice(0, visibleScenesCount).map(({ scene, watchTime, plays, duration }, index) => {
                      const displayTitle = scene.title || (scene.files && scene.files[0] ? scene.files[0].basename : 'Untitled Scene');
                      const studioName = scene.studio ? scene.studio.name : 'Unknown Studio';
                      return React.createElement('a', {
                        key: scene.id,
                        href: `/scenes/${scene.id}`,
                        className: `facelift-trends-scene-card ${index === 0 ? 'first-place' : ''}`,
                        onClick: (e) => handleLinkClick(e, `/scenes/${scene.id}`, onNavigate)
                      },
                        React.createElement('div', { className: 'facelift-trends-scene-media' },
                          React.createElement('img', {
                            src: scene.paths.screenshot || '',
                            loading: 'lazy',
                            alt: displayTitle
                          }),
                          duration > 0 && React.createElement('span', { className: 'facelift-trends-scene-duration' }, formatDuration(duration))
                        ),
                        React.createElement('div', { className: 'facelift-trends-scene-content' },
                          React.createElement('h4', { className: 'facelift-trends-scene-title', title: displayTitle }, displayTitle),
                          React.createElement('div', { className: 'facelift-trends-scene-stats' },
                            React.createElement('span', { className: 'facelift-trends-scene-studio' }, studioName),
                            React.createElement('span', { className: 'facelift-trends-scene-time' }, formatDuration(watchTime))
                          )
                        )
                      );
                    })
                  ),
                  trendsData.scenes.length > 10 && React.createElement('div', { className: 'facelift-showmore-container', style: { marginTop: '0.75rem' } },
                    React.createElement('button', {
                      className: 'facelift-btn-showmore',
                      onClick: () => setVisibleScenesCount(prev => prev === 10 ? trendsData.scenes.length : 10)
                    }, visibleScenesCount === 10 ? `Load More (+${trendsData.scenes.length - 10})` : 'Show Less')
                  )
                )
              )
        ),

        React.createElement('div', null,
          React.createElement(CalendarWidget, {
            selectedDate: selectedDate,
            onSelectDate: setSelectedDate,
            playCountsByDate: playCountsByDate
          })
        )
      )
    );
  };

  // --- SCENE MARKER CARD SUB-COMPONENT ---
  const SceneMarkerCard = ({ marker, onNavigate }) => {
    const displayTitle = marker.title || `Marker at ${formatDuration(marker.seconds)}`;
    const sceneTitle = marker.scene?.title || `Scene ${marker.scene?.id}`;
    const posterSrc = marker.screenshot || marker.scene?.paths?.screenshot || '';
    const previewSrc = marker.preview || posterSrc || '';
    const streamUrl = marker.stream || '';

    return React.createElement('a', {
      href: `/scenes/${marker.scene?.id}?t=${Math.floor(marker.seconds)}`,
      className: 'facelift-marker-card',
      target: '_blank',
      rel: 'noopener noreferrer'
    },
      React.createElement('div', { className: 'facelift-marker-card-media' },
        streamUrl
          ? React.createElement('video', {
              src: streamUrl,
              poster: posterSrc,
              autoPlay: true,
              loop: true,
              muted: true,
              playsInline: true,
              style: {
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }
            })
          : React.createElement('img', {
              src: previewSrc,
              loading: 'lazy',
              alt: displayTitle,
              style: {
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }
            }),
        React.createElement('div', { className: 'facelift-marker-card-hover-overlay' },
          React.createElement('span', { className: 'facelift-marker-card-play-icon' }, '\u25b6\ufe0f')
        ),
        React.createElement('span', { className: 'facelift-marker-card-time' }, formatDuration(marker.seconds))
      ),
      React.createElement('div', { className: 'facelift-marker-card-footer' },
        React.createElement('h4', { className: 'facelift-marker-card-title', title: displayTitle }, displayTitle),
        React.createElement('span', { className: 'facelift-marker-card-scene-title', title: sceneTitle }, sceneTitle)
      )
    );
  };

  // --- SCENE MARKERS SPOTLIGHT COMPONENT ---
  const MarkerSpotlight = ({ onNavigate }) => {
    const [markers, setMarkers] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchMarkers = async () => {
      setLoading(true);
      const query = `
        query FindSceneMarkers {
          findSceneMarkers(filter: { per_page: 6, sort: "random" }) {
            scene_markers {
              id
              title
              seconds
              preview
              stream
              screenshot
              scene {
                id
                title
                paths {
                  screenshot
                }
              }
            }
          }
        }
      `;
      try {
        const data = await graphqlRequest(query);
        if (data && data.findSceneMarkers) {
          setMarkers(data.findSceneMarkers.scene_markers);
        }
      } catch (err) {
        console.error('Failed to fetch markers:', err);
      }
      setLoading(false);
    };

    useEffect(() => {
      fetchMarkers();
    }, []);

    return React.createElement('div', { className: 'facelift-card' },
      React.createElement('div', { className: 'facelift-section-header' },
        React.createElement('h2', { className: 'facelift-section-title' },
          React.createElement('span', { className: 'facelift-section-title-icon' }, '🔖'),
          'Marker Spotlight'
        ),
        React.createElement('button', {
          className: 'facelift-btn-refresh',
          onClick: fetchMarkers,
          disabled: loading
        },
          React.createElement('span', { className: 'facelift-btn-refresh-icon' }, '🔄'),
          ' Shuffle'
        )
      ),
      loading
        ? React.createElement('div', { className: 'facelift-empty-state' },
            React.createElement('span', { className: 'facelift-spinner' })
          )
        : markers && markers.length > 0
          ? React.createElement('div', { className: 'facelift-marker-grid' },
              markers.map(marker =>
                React.createElement(SceneMarkerCard, {
                  key: marker.id,
                  marker: marker,
                  onNavigate: onNavigate
                })
              )
            )
          : React.createElement('div', { className: 'facelift-empty-state' },
              React.createElement('div', { className: 'facelift-empty-text' }, 'No markers found in your library.')
            )
    );
  };

  // --- SCENE CARD SUB-COMPONENT ---
  const SceneCard = ({ scene, onNavigate }) => {
    const videoRef = useRef(null);
    const imgRef = useRef(null);
    const [hovering, setHovering] = useState(false);

    const handleMouseEnter = () => {
      setHovering(true);
      if (videoRef.current && scene.paths.preview) {
        videoRef.current.style.opacity = 1;
        videoRef.current.play().catch(() => {});
      }
    };

    const handleMouseLeave = () => {
      setHovering(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        videoRef.current.style.opacity = 0;
      }
    };

    const displayTitle = scene.title || (scene.files && scene.files[0] ? scene.files[0].basename : 'Untitled Scene');
    const duration = scene.files && scene.files[0] ? scene.files[0].duration : 0;
    const studioName = scene.studio ? scene.studio.name : 'Unknown Studio';

    return React.createElement('a', {
      href: `/scenes/${scene.id}`,
      className: 'facelift-scene-card',
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onClick: (e) => handleLinkClick(e, `/scenes/${scene.id}`, onNavigate)
    },
      React.createElement('div', { className: 'facelift-scene-media' },
        React.createElement('img', {
          ref: imgRef,
          src: scene.paths.screenshot || '',
          className: 'facelift-scene-screenshot',
          loading: 'lazy',
          alt: displayTitle
        }),
        scene.paths.preview && React.createElement('video', {
          ref: videoRef,
          src: scene.paths.preview,
          className: 'facelift-scene-preview',
          muted: true,
          loop: true,
          playsInline: true,
          preload: 'none'
        }),
        duration > 0 && React.createElement('span', { className: 'facelift-scene-duration' }, formatDuration(duration))
      ),
      React.createElement('div', { className: 'facelift-scene-content' },
        React.createElement('h4', { className: 'facelift-scene-title', title: displayTitle }, displayTitle),
        React.createElement('div', { className: 'facelift-scene-meta' },
          React.createElement('span', { className: 'facelift-scene-studio' }, studioName),
          scene.play_count > 0 && React.createElement('span', { className: 'facelift-scene-playcount' }, `${scene.play_count} plays`)
        )
      )
    );
  };

  // --- COLLAGE CANVAS WINDOW MANAGER SUB-COMPONENTS ---
  const CanvasWindow = ({ win, onMouseDownDrag, onMouseDownResize, onWheelImage, onClose, onReset, onImageLoad }) => {
    const imgRef = useRef(null);

    useEffect(() => {
      const el = imgRef.current;
      if (!el) return;
      const handleWheel = (e) => {
        e.preventDefault();
        onWheelImage(e, win.id);
      };
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }, [win.id, onWheelImage]);

    const handleLoad = (e) => {
      if (onImageLoad && e.target.naturalWidth && e.target.naturalHeight) {
        onImageLoad(win.id, e.target.naturalWidth, e.target.naturalHeight);
      }
    };

    return React.createElement('div', {
      className: 'facelift-canvas-window borderless',
      style: {
        left: `${win.x}px`,
        top: `${win.y}px`,
        width: `${win.width}px`,
        height: `${win.height}px`,
        zIndex: win.zIndex || 10,
        transform: `scale(${win.scale || 1})`,
        transformOrigin: 'center center'
      },
      onMouseDown: (e) => onMouseDownDrag(e, win.id)
    },
      // Floating close button (top right)
      React.createElement('button', {
        className: 'facelift-canvas-window-close-btn',
        onClick: (e) => { e.stopPropagation(); onClose(win.id); },
        title: 'Close Image'
      }, '✕'),

      // Floating reset button (top left)
      React.createElement('button', {
        className: 'facelift-canvas-window-reset-btn',
        onClick: (e) => { e.stopPropagation(); onReset(win.id); },
        title: 'Reset Image size'
      }, '🔄'),

      // Image element
      React.createElement('img', {
        ref: imgRef,
        src: win.img?.paths?.image || win.img?.paths?.thumbnail || '',
        alt: win.img.title || `Image ${win.img.id}`,
        onLoad: handleLoad,
        draggable: false,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block'
        }
      }),

      // Resize Handle
      React.createElement('div', {
        className: 'facelift-canvas-window-resize-handle borderless',
        onMouseDown: (e) => onMouseDownResize(e, win.id)
      })
    );
  };

  const CanvasWorkspace = ({ windows, setWindows, onClose }) => {
    const [activeAction, setActiveAction] = useState(null);

    const handleMouseDownDrag = (e, windowId) => {
      // Bring window to front
      const maxZ = windows.reduce((max, w) => Math.max(max, w.zIndex || 10), 10);
      setWindows(prev => prev.map(w => w.id === windowId ? { ...w, zIndex: maxZ + 1 } : w));

      if (!e) return;
      e.preventDefault();
      
      const targetWin = windows.find(w => w.id === windowId);
      if (!targetWin) return;
      setActiveAction({
        type: 'drag',
        windowId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startWinX: targetWin.x,
        startWinY: targetWin.y
      });
    };

    const handleMouseDownResize = (e, windowId) => {
      e.preventDefault();
      e.stopPropagation();
      
      const maxZ = windows.reduce((max, w) => Math.max(max, w.zIndex || 10), 10);
      setWindows(prev => prev.map(w => w.id === windowId ? { ...w, zIndex: maxZ + 1 } : w));

      const targetWin = windows.find(w => w.id === windowId);
      if (!targetWin) return;
      setActiveAction({
        type: 'resize',
        windowId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startWidth: targetWin.width,
        startHeight: targetWin.height
      });
    };

    const handleWheelImage = (e, windowId) => {
      const zoomIntensity = 0.08;
      setWindows(prev => prev.map(w => {
        if (w.id !== windowId) return w;
        let newScale = w.scale + (e.deltaY < 0 ? zoomIntensity : -zoomIntensity);
        newScale = Math.max(0.1, Math.min(newScale, 10));
        return { ...w, scale: newScale };
      }));
    };

    const handleMouseMove = (e) => {
      if (!activeAction) return;
      e.preventDefault();

      const { type, windowId, startMouseX, startMouseY } = activeAction;
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;

      setWindows(prev => prev.map(w => {
        if (w.id !== windowId) return w;
        if (type === 'drag') {
          return { ...w, x: activeAction.startWinX + dx, y: activeAction.startWinY + dy };
        } else if (type === 'resize') {
          // Maintain aspect ratio during resize if natural dimensions are loaded
          const newWidth = Math.max(100, activeAction.startWidth + dx);
          let newHeight = Math.max(100, activeAction.startHeight + dy);
          if (w.naturalWidth && w.naturalHeight) {
            newHeight = newWidth * (w.naturalHeight / w.naturalWidth);
          }
          return {
            ...w,
            width: newWidth,
            height: newHeight
          };
        }
        return w;
      }));
    };

    const handleMouseUp = () => {
      setActiveAction(null);
    };

    const handleCloseWindow = (windowId) => {
      setWindows(prev => prev.filter(w => w.id !== windowId));
    };

    const handleResetWindow = (windowId) => {
      setWindows(prev => prev.map(w => {
        if (w.id !== windowId) return w;
        let newWidth = w.width;
        let newHeight = w.height;
        if (w.naturalWidth && w.naturalHeight) {
          const maxDim = Math.max(w.width, w.height);
          if (w.naturalWidth > w.naturalHeight) {
            newWidth = maxDim;
            newHeight = maxDim * (w.naturalHeight / w.naturalWidth);
          } else {
            newHeight = maxDim;
            newWidth = maxDim * (w.naturalWidth / w.naturalHeight);
          }
        }
        return { ...w, scale: 1, width: newWidth, height: newHeight };
      }));
    };

    const handleResetAll = () => {
      const N = windows.length;
      const canvasWidth = window.innerWidth || 1600;
      const canvasHeight = (window.innerHeight || 900) - 80;

      let cols = 1;
      let rows = 1;
      if (N > 6) { cols = 3; rows = 3; }
      else if (N > 4) { cols = 3; rows = 2; }
      else if (N > 2) { cols = 2; rows = 2; }
      else if (N > 1) { cols = 2; rows = 1; }

      const cellWidth = (canvasWidth - 100) / cols;
      const cellHeight = (canvasHeight - 100) / rows;

      setWindows(prev => prev.map((w, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);

        const centerX = 50 + col * cellWidth + cellWidth / 2;
        const centerY = 50 + row * cellHeight + cellHeight / 2;

        const baseW = Math.min(cellWidth * 0.75, 500);
        const baseH = Math.min(cellHeight * 0.75, 500);

        let newWidth = baseW;
        let newHeight = baseH;

        if (w.naturalWidth && w.naturalHeight) {
          const maxDim = Math.max(baseW, baseH);
          if (w.naturalWidth > w.naturalHeight) {
            newWidth = maxDim;
            newHeight = maxDim * (w.naturalHeight / w.naturalWidth);
          } else {
            newHeight = maxDim;
            newWidth = maxDim * (w.naturalWidth / w.naturalHeight);
          }
        }

        const x = centerX - newWidth / 2;
        const y = centerY - newHeight / 2;

        return {
          ...w,
          x,
          y,
          width: newWidth,
          height: newHeight,
          scale: 1,
          zIndex: 10 + index
        };
      }));
    };

    const handleImageLoad = (windowId, naturalWidth, naturalHeight) => {
      setWindows(prev => prev.map(w => {
        if (w.id !== windowId) return w;
        if (w.aspectRatioSet) return w;

        // Auto-scale window to fit natural aspect ratio within bounds
        const cellMax = Math.max(w.width, w.height);
        let newWidth = cellMax;
        let newHeight = cellMax;

        if (naturalWidth > naturalHeight) {
          newHeight = cellMax * (naturalHeight / naturalWidth);
        } else {
          newWidth = cellMax * (naturalWidth / naturalHeight);
        }

        // Keep center point aligned
        const cx = w.x + w.width / 2;
        const cy = w.y + w.height / 2;
        const newX = cx - newWidth / 2;
        const newY = cy - newHeight / 2;

        return {
          ...w,
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
          aspectRatioSet: true,
          naturalWidth,
          naturalHeight
        };
      }));
    };

    return React.createElement('div', {
      className: 'facelift-canvas-backdrop',
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp
    },
      // Canvas Header
      React.createElement('div', { className: 'facelift-canvas-header' },
        React.createElement('div', { className: 'facelift-canvas-header-left' },
          React.createElement('span', { className: 'facelift-canvas-header-title' }, '🎨 Collage Canvas Workspace'),
          React.createElement('span', { className: 'facelift-canvas-header-subtitle' }, `Viewing ${windows.length} image${windows.length !== 1 ? 's' : ''} simultaneously`)
        ),
        React.createElement('div', { className: 'facelift-canvas-header-actions' },
          React.createElement('button', { className: 'facelift-btn-classic-toggle', onClick: handleResetAll }, '🔄 Reset All Windows'),
          React.createElement('button', { className: 'facelift-btn-classic-toggle accent', onClick: onClose }, '✕ Close Workspace')
        )
      ),

      // Canvas Container (Workspace area)
      React.createElement('div', { className: 'facelift-canvas-area' },
        windows.length === 0
          ? React.createElement('div', { className: 'facelift-empty-state' },
              React.createElement('div', { className: 'facelift-empty-icon' }, '🖼️'),
              React.createElement('div', { className: 'facelift-empty-text' }, 'All windows closed. Close workspace to select more images.')
            )
          : windows.map(win =>
              React.createElement(CanvasWindow, {
                key: win.id,
                win,
                onMouseDownDrag: handleMouseDownDrag,
                onMouseDownResize: handleMouseDownResize,
                onWheelImage: handleWheelImage,
                onClose: handleCloseWindow,
                onReset: handleResetWindow,
                onImageLoad: handleImageLoad
              })
            )
      )
    );
  };

  // --- SINGLE-PAGE ROUTING INTERCEPTORS & DOM MOUNT SYSTEM ---
  let isUpdating = false;

  const setupFaceliftDashboard = () => {
    if (isUpdating) return;

    if (localStorage.getItem('facelift-show-classic') === 'true') {
      removeFaceliftDashboard();
      injectSwitchButton();
      return;
    }

    const main = document.querySelector('.main') || document.querySelector('.main-container');
    if (!main) return;

    removeSwitchButton();

    isUpdating = true;

    let faceliftDiv = document.getElementById('facelift-dashboard');
    let needsRender = false;

    if (!faceliftDiv) {
      faceliftDiv = document.createElement('div');
      faceliftDiv.id = 'facelift-dashboard';
      main.appendChild(faceliftDiv);
      needsRender = true;
    }

    if (faceliftDiv.style.display === 'none') {
      faceliftDiv.style.display = '';
      needsRender = true;
    }

    Array.from(main.children).forEach(child => {
      if (child.id !== 'facelift-dashboard') {
        if (child.style.display !== 'none') {
          child.style.setProperty('display', 'none', 'important');
        }
      }
    });

    if (needsRender) {
      const element = React.createElement(FaceliftLanding, {
        onShowOriginal: () => {
          localStorage.setItem('facelift-show-classic', 'true');
          removeFaceliftDashboard();
          injectSwitchButton();
        }
      });

      if (ReactDOM.createRoot) {
        if (!faceliftDiv._reactRoot) {
          faceliftDiv._reactRoot = ReactDOM.createRoot(faceliftDiv);
        }
        faceliftDiv._reactRoot.render(element);
      } else {
        ReactDOM.render(element, faceliftDiv);
      }
    }

    setTimeout(() => { isUpdating = false; }, 50);
  };

  const removeFaceliftDashboard = () => {
    const faceliftDiv = document.getElementById('facelift-dashboard');
    if (faceliftDiv) {
      if (faceliftDiv._reactRoot && faceliftDiv._reactRoot.unmount) {
        try {
          faceliftDiv._reactRoot.unmount();
        } catch(e) {}
        delete faceliftDiv._reactRoot;
      } else if (ReactDOM.unmountComponentAtNode) {
        try {
          ReactDOM.unmountComponentAtNode(faceliftDiv);
        } catch(e) {}
      }
      faceliftDiv.remove();
    }

    const main = document.querySelector('.main') || document.querySelector('.main-container');
    if (main) {
      Array.from(main.children).forEach(child => {
        if (child.id !== 'facelift-dashboard') {
          child.style.display = '';
        }
      });
    }
  };

  // --- FLOATING ACTION SWITCH BUTTON (TO GO FROM CLASSIC -> FACELIFT) ---
  const injectSwitchButton = () => {
    if (document.getElementById('facelift-restore-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'facelift-restore-fab';
    fab.innerHTML = '✨ Enable Facelift';
    fab.addEventListener('click', () => {
      localStorage.removeItem('facelift-show-classic');
      fab.remove();
      setupFaceliftDashboard();
    });

    document.body.appendChild(fab);
  };

  const removeSwitchButton = () => {
    const fab = document.getElementById('facelift-restore-fab');
    if (fab) fab.remove();
  };

  // --- ROUTE MATCHING & OBSERVATION SYSTEM ---
  const checkRoute = () => {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') {
      setupFaceliftDashboard();
    } else {
      removeFaceliftDashboard();
      removeSwitchButton();
    }
  };

  const originalPush = window.history.pushState;
  window.history.pushState = function (...args) {
    originalPush.apply(this, args);
    setTimeout(checkRoute, 50);
  };

  const originalReplace = window.history.replaceState;
  window.history.replaceState = function (...args) {
    originalReplace.apply(this, args);
    setTimeout(checkRoute, 50);
  };

  window.addEventListener('popstate', checkRoute);

  const observer = new MutationObserver(() => {
    checkRoute();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  checkRoute();
})();
