import React from 'react';
import styles from './ExamNavigator.module.css';
import { NavigationState } from '../hooks/useGotoNavigation';

interface ExamNavigatorProps {
  totalQuestions: number;
  navigationState: NavigationState;
  onNavigate: (index: number) => void;
  // questionIds maps display index to actual question id for looking up answered state
  questionIds: number[]; 
}

export function ExamNavigator({ totalQuestions, navigationState, onNavigate, questionIds }: ExamNavigatorProps) {
  return (
    <div className={styles.navContainer}>
      <div className={styles.navGrid}>
        {Array.from({ length: totalQuestions }).map((_, index) => {
          const qId = questionIds[index];
          const isCurrent = navigationState.currentIndex === index;
          const isMarked = navigationState.marked.has(index);
          const isAnswered = qId !== undefined && navigationState.answered.has(qId);
          
          let btnClass = styles.navUnvisited;
          if (isAnswered) btnClass = styles.navAnswered;
          else if (isMarked) btnClass = styles.navMarked;

          return (
            <button
              key={index}
              onClick={() => onNavigate(index)}
              className={`${styles.navButton} ${btnClass} ${isCurrent ? styles.navCurrent : ''}`}
              aria-label={`Go to question ${index + 1}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} />
          <span>Unvisited</span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ backgroundColor: 'var(--color-success)' }} />
          <span>Answered</span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ backgroundColor: 'var(--color-warning)' }} />
          <span>Marked</span>
        </div>
      </div>
    </div>
  );
}
