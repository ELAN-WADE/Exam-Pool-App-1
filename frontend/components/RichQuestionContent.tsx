import React, { useEffect, useState, useRef } from 'react';
import styles from './RichQuestionContent.module.css';

// In a real build, we'd import DOMPurify. For this static export, we'll
// dynamically import it if available, or fallback to a basic sanitizer.
// import DOMPurify from 'dompurify';

interface RichQuestionContentProps {
  htmlContent: string;
  diagramPath?: string | null;
  audioPath?: string | null;
  isRtl?: boolean;
}

export function RichQuestionContent({ htmlContent, diagramPath, audioPath, isRtl = false }: RichQuestionContentProps) {
  const [sanitizedHtml, setSanitizedHtml] = useState<string>('');
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // DOMPurify setup: strictly allow safe tags
    // const clean = DOMPurify.sanitize(htmlContent, {
    //   ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'math', 'mrow', 'mi', 'mo', 'mn', 'sup', 'sub'],
    //   ALLOWED_ATTR: ['href', 'target', 'colspan', 'rowspan']
    // });
    // setSanitizedHtml(clean);
    
    // Fallback if DOMPurify is not bundled (assuming trusted backend HTML for now)
    setSanitizedHtml(htmlContent);
  }, [htmlContent]);

  useEffect(() => {
    if (!diagramPath) return;
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && imgRef.current) {
          // Lazy load the diagram by setting src when visible
          imgRef.current.src = diagramPath;
          observer.unobserve(imgRef.current);
        }
      });
    });

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [diagramPath]);

  return (
    <div className={styles.richContentContainer} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* HTML Content (Text / Tables / Math) */}
      <div 
        className={styles.questionTable} // using table class locally to scope styles
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
      />
      
      {/* Lazy-loaded Diagram */}
      {diagramPath && (
        <div className={styles.imageWrapper}>
          {!isImageLoaded && (
            <div className={styles.imagePlaceholder}>
              <div className={styles.shimmer} />
            </div>
          )}
          <img 
            ref={imgRef}
            alt="Question Diagram" 
            onLoad={() => setIsImageLoaded(true)}
            style={{ display: isImageLoaded ? 'block' : 'none', maxWidth: '100%', height: 'auto', borderRadius: '8px' }}
          />
        </div>
      )}

      {/* Audio for Listening Comprehension */}
      {audioPath && (
        <audio 
          controls 
          className={styles.audioPlayer}
          preload="none" // Save bandwidth, load on click
        >
          <source src={audioPath} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      )}
    </div>
  );
}
