import React from 'react';
import { createPortal } from 'react-dom';
import styles from './Calculator.module.css';
import { useCalculator, CalculatorMode } from '../hooks/useCalculator';

interface ExamCalculatorProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: CalculatorMode;
}

export function ExamCalculator({ isOpen, onClose, mode = 'standard' }: ExamCalculatorProps) {
  const { state, dispatch } = useCalculator(mode, onClose);

  if (!isOpen) return null;

  // Render via portal to body
  const calculatorContent = (
    <div className={styles.calculatorOverlay} onClick={onClose}>
      <div className={styles.calculatorPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.calcHeader}>
          <span>{mode === 'scientific' ? 'Scientific Calculator' : 'Standard Calculator'}</span>
          <button className={styles.closeButton} onClick={onClose}>&times;</button>
        </div>
        
        <div className={styles.calcDisplay}>
          {state.displayValue}
        </div>
        
        {mode === 'scientific' && (
          <div className={styles.calcKeypad} style={{ marginBottom: '0.5rem' }}>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'sin' })}>sin</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'cos' })}>cos</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'tan' })}>tan</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'sqrt' })}>√</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'log' })}>log</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'ln' })}>ln</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'sq' })}>x²</button>
            <button className={`${styles.calcButton} ${styles.calcFunction}`} onClick={() => dispatch({ type: 'COMPUTE_SCIENTIFIC', func: 'cube' })}>x³</button>
          </div>
        )}

        <div className={styles.calcKeypad}>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'CLEAR' })}>C</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'TOGGLE_SIGN' })}>±</button>
          <button className={`${styles.calcButton} ${styles.calcOperator}`} onClick={() => dispatch({ type: 'PERFORM_OPERATION', nextOperator: '%' })}>%</button>
          <button className={`${styles.calcButton} ${styles.calcOperator}`} onClick={() => dispatch({ type: 'PERFORM_OPERATION', nextOperator: '/' })}>÷</button>

          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '7' })}>7</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '8' })}>8</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '9' })}>9</button>
          <button className={`${styles.calcButton} ${styles.calcOperator}`} onClick={() => dispatch({ type: 'PERFORM_OPERATION', nextOperator: '*' })}>×</button>

          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '4' })}>4</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '5' })}>5</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '6' })}>6</button>
          <button className={`${styles.calcButton} ${styles.calcOperator}`} onClick={() => dispatch({ type: 'PERFORM_OPERATION', nextOperator: '-' })}>−</button>

          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '1' })}>1</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '2' })}>2</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '3' })}>3</button>
          <button className={`${styles.calcButton} ${styles.calcOperator}`} onClick={() => dispatch({ type: 'PERFORM_OPERATION', nextOperator: '+' })}>+</button>

          <button className={styles.calcButton} style={{ gridColumn: 'span 2' }} onClick={() => dispatch({ type: 'INPUT_DIGIT', digit: '0' })}>0</button>
          <button className={styles.calcButton} onClick={() => dispatch({ type: 'INPUT_DECIMAL' })}>.</button>
          <button className={`${styles.calcButton} ${styles.calcEquals}`} onClick={() => dispatch({ type: 'PERFORM_OPERATION', nextOperator: '=' })}>=</button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(calculatorContent, document.body) : null;
}
