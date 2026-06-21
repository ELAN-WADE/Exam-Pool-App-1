import { useState, useCallback } from 'react';

export interface NavigationState {
  currentIndex: number;
  visited: Set<number>;
  marked: Set<number>;
  answered: Map<number, string>;
}

export function useGotoNavigation(initialTotal: number) {
  const [state, setState] = useState<NavigationState>({
    currentIndex: 0,
    visited: new Set([0]),
    marked: new Set(),
    answered: new Map(),
  });

  const navigateTo = useCallback((index: number) => {
    setState(prev => {
      const newVisited = new Set(prev.visited);
      newVisited.add(index);
      return { ...prev, currentIndex: index, visited: newVisited };
    });
  }, []);

  const toggleMarked = useCallback((index: number) => {
    setState(prev => {
      const newMarked = new Set(prev.marked);
      if (newMarked.has(index)) {
        newMarked.delete(index);
      } else {
        newMarked.add(index);
      }
      return { ...prev, marked: newMarked };
    });
  }, []);

  const answerQuestion = useCallback((id: number, answer: string) => {
    setState(prev => {
      const newAnswered = new Map(prev.answered);
      newAnswered.set(id, answer);
      return { ...prev, answered: newAnswered };
    });
  }, []);

  return {
    state,
    navigateTo,
    toggleMarked,
    answerQuestion,
  };
}
