import React, { useEffect, useState, useRef } from 'react';
import styles from './RichQuestionContent.module.css';

// [SECURITY FIX VULN-12] DOMPurify enabled with a strict allowlist.
// The original code had DOMPurify commented out with a fallback of
// `setSanitizedHtml(htmlContent)` — raw unsanitised HTML from the DB.
// A malicious teacher could store <script> or <img onerror=...> in a question,
// executing arbitrary JS in every student's browser during an exam.
import DOMPurify from 'dompurify';

interface RichQuestionContentProps {
  htmlContent: string;
  diagramPath?: string | null;
  audioPath?: string | null;
  isRtl?: boolean;
}

// Strict allowlist: presentation-only tags, no script/style/form/iframe.
const DOMPURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'b', 'i', 'em', 'strong', 'u', 's', 'p', 'br', 'span',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'sup', 'sub',
    'math', 'mrow', 'mi', 'mo', 'mn', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub',
    'h1', 'h2', 'h3', 'h4',
    'blockquote', 'code', 'pre',
  ],
  ALLOWED_ATTR: ['colspan', 'rowspan', 'align', 'class'],
  // Force all URLs to be relative — strips href, src, action etc.
  FORBID_ATTR: ['href', 'src', 'action', 'formaction', 'style', 'onerror', 'onload', 'onclick'],
};

/**
 * [SECURITY FIX VULN-15] Only allow relative paths for diagram images.
 * Rejects http://, https://, data:, javascript:, // and any other
 * non-relative URI that could be used for cross-origin tracking or XSS.
 */
function isSafeDiagramPath(path: string | null | undefined): boolean {
  if (!path) return false;
  // Must start with / and not //  (protocol-relative)
  return path.startsWith('/') && !path.startsWith('//');
}

export function RichQuestionContent({ htmlContent, diagramPath, audioPath, isRtl = false }: RichQuestionContentProps) {
  const [sanitizedHtml, setSanitizedHtml] = useState<string>('');
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // [SECURITY FIX VULN-12] Sanitize question HTML before rendering.
    // typeof window check ensures this only runs client-side (DOMPurify needs DOM).
    if (typeof window !== 'undefined') {
      const clean = DOMPurify.sanitize(htmlContent || '', DOMPURIFY_CONFIG);
      setSanitizedHtml(clean as string);
    }
  }, [htmlContent]);

  useEffect(() => {
    // [SECURITY FIX VULN-15] Reject any non-relative diagramPath.
    if (!isSafeDiagramPath(diagramPath)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && imgRef.current) {
          // Safe to set: path has already been validated as relative-only
          imgRef.current.src = diagramPath!;
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
      {/* HTML Content (Text / Tables / Math) — sanitized by DOMPurify */}
      <div
        className={styles.questionTable}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />

      {/* Lazy-loaded Diagram — only rendered if path is a safe relative path */}
      {isSafeDiagramPath(diagramPath) && (
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
          preload="none"
        >
          <source src={audioPath} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      )}
    </div>
  );
}
