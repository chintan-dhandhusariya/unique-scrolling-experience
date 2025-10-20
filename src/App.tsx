import { useEffect, useRef, useState } from 'react';
import { sections } from './content';
import { AnimationPhase, SectionLayout } from './types';
import { INACTIVITY_TIMEOUT, ANIMATION_DURATION, ZOOM_OUT_SCALE, UI_LAYOUT } from './constants';
import { getViewportCenter, easeOutCubic, easeInOutCubic, clampScroll } from './utils';

function App() {
  // State
  const [uiVisibility, setUiVisibility] = useState({
    sidebar: false,
    scrollbar: false,
  });
  const [currentSectionId, setCurrentSectionId] = useState('genesis');
  const [sectionScrollProgress, setSectionScrollProgress] = useState<Record<string, number>>({});
  const [sectionHeightPercentages, setSectionHeightPercentages] = useState<Record<string, number>>({});
  const [sectionLayouts, setSectionLayouts] = useState<SectionLayout[]>([]);
  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>('idle');
  const [scrollState, setScrollState] = useState({
    virtual: 0,
    animated: 0,
  });
  const [zoomState, setZoomState] = useState({
    level: 1,
    pivotY: 0,
  });

  // Refs
  const timeouts = useRef({
    sidebar: null as number | null,
    scrollbar: null as number | null,
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const isAnimating = useRef(false);
  const scrollFillAnimationId = useRef<number | null>(null);
  
  const calculateSectionHeightPercentages = (): Record<string, number> => {
    const heights: Record<string, number> = {};
    let totalHeight = 0;

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        heights[section.id] = element.offsetHeight;
        totalHeight += element.offsetHeight;
      }
    });

    const percentages: Record<string, number> = {};
    sections.forEach((section) => {
      percentages[section.id] = (heights[section.id] / totalHeight) * 100;
    });

    return percentages;
  };

  const calculateSectionLayouts = (): SectionLayout[] => {
    return sections
      .map((section) => {
        const el = document.getElementById(section.id);
        if (!el) return null;
        const start = el.offsetTop;
        const height = el.offsetHeight;
        return { id: section.id, start, end: start + height, height };
      })
      .filter(Boolean) as SectionLayout[];
  };

  const getSectionOffset = (sectionId: string): number => {
    const layout = sectionLayouts.find((s) => s.id === sectionId);
    return layout?.start ?? document.getElementById(sectionId)?.offsetTop ?? 0;
  };

  
  const calculateScrollProgress = (scrollY: number): {
    fills: Record<string, number>;
    activeId: string;
  } => {
    if (!sectionLayouts.length) {
      return { fills: {}, activeId: sections[0].id };
    }

    const centerY = getViewportCenter(scrollY);
    const fills: Record<string, number> = {};
    let activeId = sections[0].id;

    for (const layout of sectionLayouts) {
      if (centerY < layout.start) {
        fills[layout.id] = 0;
      } else if (centerY > layout.end) {
        fills[layout.id] = 100;
      } else {
        fills[layout.id] = ((centerY - layout.start) / layout.height) * 100;
        activeId = layout.id;
      }
    }

    return { fills, activeId };
  };

  const getScrollFillHeight = (sectionId: string): number => {
    if (!sectionLayouts.length) return 0;

    const centerY = getViewportCenter(scrollState.animated);
    if (centerY <= window.innerHeight / 2) return 0;

    const layout = sectionLayouts.find((s) => s.id === sectionId);
    if (!layout) return 0;

    if (centerY <= layout.start) return 0;
    if (centerY >= layout.end) return 100;

    const maxScroll = (contentRef.current?.scrollHeight || 0) - window.innerHeight;
    const totalDocHeight = sectionLayouts[sectionLayouts.length - 1]?.end || 1;

    // Special case: ensure last section reaches 100%
    if (
      sectionId === sections[sections.length - 1].id &&
      (centerY >= totalDocHeight - 50 || scrollState.virtual >= maxScroll - 10)
    ) {
      return 100;
    }

    const sectionProgress = (centerY - layout.start) / (layout.end - layout.start);
    return Math.max(0, Math.min(100, sectionProgress * 100));
  };

  
  const createVisibilityHandler = (
    key: 'sidebar' | 'scrollbar',
    timeoutDuration = INACTIVITY_TIMEOUT
  ) => {
    return () => {
      setUiVisibility((prev) => ({ ...prev, [key]: true }));

      if (timeouts.current[key]) {
        clearTimeout(timeouts.current[key]!);
      }

      timeouts.current[key] = window.setTimeout(() => {
        if (animationPhase === 'idle') {
          setUiVisibility((prev) => ({ ...prev, [key]: false }));
        }
      }, timeoutDuration);
    };
  };

  const showSidebar = createVisibilityHandler('sidebar');
  const showScrollbar = createVisibilityHandler('scrollbar');

  const animateScrollFill = (targetY: number) => {
    if (scrollFillAnimationId.current) {
      cancelAnimationFrame(scrollFillAnimationId.current);
    }

    const startY = scrollState.animated;
    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(1, elapsed / ANIMATION_DURATION.SCROLL_FILL);
      const easedProgress = easeOutCubic(progress);

      const newY = startY + (targetY - startY) * easedProgress;
      setScrollState((prev) => ({ ...prev, animated: newY }));

      if (progress < 1) {
        scrollFillAnimationId.current = requestAnimationFrame(animate);
      } else {
        setScrollState((prev) => ({ ...prev, animated: targetY }));
        scrollFillAnimationId.current = null;
      }
    };

    scrollFillAnimationId.current = requestAnimationFrame(animate);
  };

  const performThreePhaseNavigation = (targetY: number) => {
    if (isAnimating.current) return;

    isAnimating.current = true;
    setAnimationPhase('zoomOut');

    const startY = scrollState.virtual;
    const centerY = getViewportCenter(startY);
    setZoomState({ level: 1, pivotY: centerY });

    animateScrollFill(targetY);

    let phase = 1;
    let phaseStartTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!phaseStartTime) phaseStartTime = timestamp;
      const elapsed = timestamp - phaseStartTime;

      if (phase === 1) {
        // Phase 1: Zoom Out
        const progress = Math.min(1, elapsed / ANIMATION_DURATION.ZOOM_OUT);
        setZoomState((prev) => ({
          ...prev,
          level: 1 - (1 - ZOOM_OUT_SCALE) * progress,
        }));

        if (progress === 1) {
          phase = 2;
          phaseStartTime = timestamp;
          setAnimationPhase('scrolling');
        }
      } else if (phase === 2) {
        // Phase 2: Scroll while zoomed out
        const progress = Math.min(1, elapsed / ANIMATION_DURATION.SCROLL);
        const easedProgress = easeInOutCubic(progress);
        const compressedDistance = (targetY - startY) * ZOOM_OUT_SCALE;

        setScrollState((prev) => ({
          ...prev,
          virtual: startY + compressedDistance * easedProgress,
        }));

        if (progress === 1) {
          phase = 3;
          phaseStartTime = timestamp;
          setAnimationPhase('zoomIn');
        }
      } else if (phase === 3) {
        // Phase 3: Zoom In
        const progress = Math.min(1, elapsed / ANIMATION_DURATION.ZOOM_IN);
        const compressedDistance = (targetY - startY) * ZOOM_OUT_SCALE;
        const remainingDistance = targetY - startY - compressedDistance;

        setZoomState((prev) => ({
          ...prev,
          level: ZOOM_OUT_SCALE + (1 - ZOOM_OUT_SCALE) * progress,
        }));
        setScrollState((prev) => ({
          ...prev,
          virtual: startY + compressedDistance + remainingDistance * progress,
        }));

        if (progress === 1) {
          setZoomState({ level: 1, pivotY: centerY });
          setScrollState((prev) => ({ ...prev, virtual: targetY }));
          setAnimationPhase('idle');
          isAnimating.current = false;
          return;
        }
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };

  const handleScrollbarClick = (clickY: number, scrollbarHeight: number) => {
    let accumulatedHeight = 0;
    let clickedSection = null;
    let clickYWithinSection = clickY;

    for (const section of sections) {
      const segmentHeight = (sectionHeightPercentages[section.id] || 0) * scrollbarHeight / 100;
      if (clickY >= accumulatedHeight && clickY < accumulatedHeight + segmentHeight) {
        clickedSection = section;
        clickYWithinSection = clickY - accumulatedHeight;
        break;
      }
      accumulatedHeight += segmentHeight;
    }

    if (!clickedSection) return;

    const layout = sectionLayouts.find((s) => s.id === clickedSection.id);
    if (!layout) return;

    const segmentHeight = (sectionHeightPercentages[clickedSection.id] || 0) * scrollbarHeight / 100;
    const clickRatio = Math.min(1, Math.max(0, clickYWithinSection / segmentHeight));
    const targetY = layout.start + clickRatio * layout.height;
    const scrollTarget = targetY - window.innerHeight / 2 - clickRatio * layout.height * 0.1;

    performThreePhaseNavigation(scrollTarget);
  };

  const handleSectionClick = (sectionId: string) => {
    const targetY = getSectionOffset(sectionId);
    performThreePhaseNavigation(targetY);
  };

  const handleWheel = (e: WheelEvent) => {
    if (isAnimating.current) return;
    e.preventDefault();

    setScrollState((prev) => {
      const maxScroll = (contentRef.current?.scrollHeight || 0) - window.innerHeight;
      const newY = clampScroll(prev.virtual + e.deltaY, maxScroll);
      return { ...prev, virtual: newY };
    });
  };

  // Effects
  useEffect(() => {
    const updateHeights = () => setSectionHeightPercentages(calculateSectionHeightPercentages());
    updateHeights();
    window.addEventListener('resize', updateHeights);
    return () => window.removeEventListener('resize', updateHeights);
  }, []);

  useEffect(() => {
    const updateLayouts = () => setSectionLayouts(calculateSectionLayouts());
    updateLayouts();
    window.addEventListener('resize', updateLayouts);
    return () => window.removeEventListener('resize', updateLayouts);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', showSidebar);
    window.addEventListener('wheel', showScrollbar);

    return () => {
      window.removeEventListener('mousemove', showSidebar);
      window.removeEventListener('wheel', showScrollbar);
      Object.values(timeouts.current).forEach((id) => id && clearTimeout(id));
    };
  }, [animationPhase]);

  useEffect(() => {
    showScrollbar();
  }, [scrollState.virtual]);

  useEffect(() => {
    const { fills, activeId } = calculateScrollProgress(scrollState.virtual);
    setSectionScrollProgress(fills);
    setCurrentSectionId(activeId);
  }, [scrollState.virtual, scrollState.animated, sectionLayouts]);

  useEffect(() => {
    if (!isAnimating.current) {
      setScrollState((prev) => ({ ...prev, animated: prev.virtual }));
    }
  }, [scrollState.virtual]);

  useEffect(() => {
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  const renderSection = (section: typeof sections[0], index: number) => (
    <section
      key={section.id}
      id={section.id}
      className={section.background || 'bg-white'}
      style={{
        width: '100vw',
        minHeight: index % 3 === 0 ? '600px' : index % 2 === 0 ? '400px' : '500px',
        marginBottom: 0,
      }}
    >
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px' }}>
        <h2 className="text-4xl font-bold mb-8 text-gray-900">{section.title}</h2>
        <div className="space-y-6 text-gray-700 text-lg leading-relaxed">
          {section.content.map((paragraph, pIndex) => (
            <p key={pIndex}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  );

  const renderSectionButton = (section: typeof sections[0]) => (
    <button
      key={section.id}
      onClick={() => handleSectionClick(section.id)}
      className="text-right group"
      style={{
        height: `${sectionHeightPercentages[section.id] || 0}%`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        paddingTop: '2px',
      }}
    >
      <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
        {section.title}
      </div>
    </button>
  );

  const renderScrollbarSegment = (section: typeof sections[0], index: number) => (
    <div
      key={`section-${section.id}`}
      style={{
        position: 'relative',
        height: `${sectionHeightPercentages[section.id] || 0}%`,
      }}
    >
      <div
        style={{
          height: '100%',
          backgroundColor: '#e5e7eb',
          position: 'relative',
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: `${getScrollFillHeight(section.id)}%`,
          background: '#3b82f6',
          zIndex: 1,
        }}
      />
      {index < sections.length - 1 && (
        <div style={{ height: '3px', backgroundColor: '#f3f4f6', zIndex: 3, position: 'relative' }} />
      )}
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#FFF8E7',
        zIndex: 0,
      }}
    >
      {/* Content */}
      <div
        ref={contentRef}
        style={{
          position: 'relative',
          width: '100vw',
          height: '100%',
          willChange: 'transform',
          transform: `translateY(-${scrollState.virtual}px) scale(${zoomState.level})`,
          transformOrigin: `center ${zoomState.pivotY || getViewportCenter(scrollState.virtual)}px`,
          transition: 'none',
          zIndex: 1,
        }}
      >
        <main>{sections.map(renderSection)}</main>
      </div>

      {/* Sidebar Navigation */}
      <nav
        className={`hidden md:flex h-full flex-col transition-opacity duration-300 ${
          uiVisibility.sidebar ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onMouseEnter={() => setUiVisibility((prev) => ({ ...prev, sidebar: true }))}
        onMouseLeave={() => {
          if (animationPhase === 'idle') {
            setUiVisibility((prev) => ({ ...prev, sidebar: false }));
          }
        }}
        style={{
          position: 'absolute',
          top: UI_LAYOUT.SIDEBAR_TOP,
          right: UI_LAYOUT.SIDEBAR_RIGHT,
          height: `calc(100% - ${UI_LAYOUT.TOTAL_VERTICAL_PADDING}px)`,
          zIndex: 2,
          background: 'transparent',
        }}
      >
        <div className="flex flex-col h-full">{sections.map(renderSectionButton)}</div>
      </nav>

      {/* Current Section Indicator */}
      <div
        style={{
          position: 'absolute',
          top: UI_LAYOUT.CURRENT_SECTION_TOP,
          right: UI_LAYOUT.SCROLLBAR_RIGHT,
          maxWidth: '200px',
          zIndex: 3,
        }}
      >
        <div
          style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#3b82f6',
            marginBottom: '12px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sections.find((s) => s.id === currentSectionId)?.title || ''}
        </div>
      </div>

      {/* Scrollbar */}
      <div
        className={`hidden md:block transition-opacity duration-300 ${
          uiVisibility.scrollbar || uiVisibility.sidebar ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          position: 'absolute',
          top: UI_LAYOUT.SIDEBAR_TOP,
          right: UI_LAYOUT.SCROLLBAR_RIGHT,
          height: `calc(100% - ${UI_LAYOUT.TOTAL_VERTICAL_PADDING}px)`,
          width: `${UI_LAYOUT.SCROLLBAR_WIDTH}px`,
          zIndex: 3,
        }}
      >
        <div
          className="w-2 cursor-pointer relative"
          style={{ height: '100%', padding: '2px 0', background: 'transparent' }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            handleScrollbarClick(e.clientY - rect.top, rect.height);
          }}
        >
          {sections.map(renderScrollbarSegment)}
        </div>
      </div>
    </div>
  );
}

export default App;
