import { useState, useRef } from 'react';
import './Tooltip.css';

export default function Tooltip({ text, children, position = 'top' }) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);

  const show = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 300);
  };

  const hide = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  return (
    <span className="tooltip-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && <span className={`tooltip-bubble tooltip-bubble--${position}`} role="tooltip">{text}</span>}
    </span>
  );
}
