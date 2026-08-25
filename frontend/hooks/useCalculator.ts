import { useReducer, useEffect } from 'react';

export type CalculatorMode = "standard" | "scientific";

export interface CalculatorState {
  displayValue: string;
  operand: number | null;
  operator: string | null;
  waitingForNewOperand: boolean;
  mode: CalculatorMode;
}

export type CalculatorAction = 
  | { type: 'INPUT_DIGIT'; digit: string }
  | { type: 'INPUT_DECIMAL' }
  | { type: 'CLEAR' }
  | { type: 'TOGGLE_SIGN' }
  | { type: 'PERFORM_OPERATION'; nextOperator: string }
  | { type: 'COMPUTE_SCIENTIFIC'; func: 'sin' | 'cos' | 'tan' | 'log' | 'ln' | 'sqrt' | 'sq' | 'cube' };

const initialState: CalculatorState = {
  displayValue: '0',
  operand: null,
  operator: null,
  waitingForNewOperand: false,
  mode: 'standard',
};

function calculatorReducer(state: CalculatorState, action: CalculatorAction): CalculatorState {
  switch (action.type) {
    case 'INPUT_DIGIT':
      if (state.waitingForNewOperand) {
        return {
          ...state,
          displayValue: action.digit,
          waitingForNewOperand: false
        };
      }
      return {
        ...state,
        displayValue: state.displayValue === '0' ? action.digit : state.displayValue + action.digit
      };

    case 'INPUT_DECIMAL':
      if (state.waitingForNewOperand) {
        return {
          ...state,
          displayValue: '0.',
          waitingForNewOperand: false
        };
      }
      if (state.displayValue.indexOf('.') === -1) {
        return {
          ...state,
          displayValue: state.displayValue + '.'
        };
      }
      return state;

    case 'CLEAR':
      return { ...initialState, mode: state.mode };

    case 'TOGGLE_SIGN':
      return {
        ...state,
        displayValue: String(parseFloat(state.displayValue) * -1)
      };

    case 'PERFORM_OPERATION': {
      const inputValue = parseFloat(state.displayValue);
      if (state.operand == null) {
        return {
          ...state,
          operand: inputValue,
          operator: action.nextOperator,
          waitingForNewOperand: true
        };
      }
      if (state.operator) {
        let result = state.operand;
        if (state.operator === '+') result += inputValue;
        else if (state.operator === '-') result -= inputValue;
        else if (state.operator === '*') result *= inputValue;
        else if (state.operator === '/') result /= inputValue;

        return {
          ...state,
          displayValue: String(result),
          operand: result,
          operator: action.nextOperator,
          waitingForNewOperand: true
        };
      }
      return state;
    }

    case 'COMPUTE_SCIENTIFIC': {
      const val = parseFloat(state.displayValue);
      let res = val;
      switch (action.func) {
        case 'sin': res = Math.sin(val); break;
        case 'cos': res = Math.cos(val); break;
        case 'tan': res = Math.tan(val); break;
        case 'log': res = Math.log10(val); break;
        case 'ln': res = Math.log(val); break;
        case 'sqrt': res = Math.sqrt(val); break;
        case 'sq': res = val * val; break;
        case 'cube': res = val * val * val; break;
      }
      return {
        ...state,
        displayValue: String(res),
        waitingForNewOperand: true
      };
    }

    default:
      return state;
  }
}

export function useCalculator(initialMode: CalculatorMode = 'standard', onClose: () => void) {
  const [state, dispatch] = useReducer(calculatorReducer, { ...initialState, mode: initialMode });

  // Keyboard trap and Escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      
      // Stop event propagation to prevent it from interacting with the exam underneath
      e.stopPropagation();

      if (/[0-9]/.test(e.key)) {
        dispatch({ type: 'INPUT_DIGIT', digit: e.key });
      } else if (e.key === '.') {
        dispatch({ type: 'INPUT_DECIMAL' });
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'c' || e.key === 'C') {
        dispatch({ type: 'CLEAR' });
      } else if (['+', '-', '*', '/'].includes(e.key)) {
        dispatch({ type: 'PERFORM_OPERATION', nextOperator: e.key });
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault(); // prevent form submit
        dispatch({ type: 'PERFORM_OPERATION', nextOperator: '=' });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to intercept early
    
    // Audit log API call on open
    fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CALC_OPEN' })
    }).catch(() => {});

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  return { state, dispatch };
}
