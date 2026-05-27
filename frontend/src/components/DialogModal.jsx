import React, { useState, useEffect, useRef } from 'react';

export default function DialogModal({ isOpen, type, title, message, initialValue, onConfirm, onCancel }) {
  const [inputValue, setInputValue] = useState(initialValue || '');
  const inputRef = useRef(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setInputValue(initialValue || '');
      if (type === 'prompt') {
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 50);
      }
    }
  }, [isOpen, initialValue, type]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (type === 'prompt') {
      onConfirm(inputValue);
    } else {
      onConfirm();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="lightbox-overlay" onClick={onCancel} style={{ zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="dialog-modal" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">{title}</div>
        {message && <div className="dialog-message">{message}</div>}
        
        {type === 'prompt' && (
          <input 
            ref={inputRef}
            type="text" 
            className="dialog-input" 
            value={inputValue} 
            onChange={e => setInputValue(e.target.value)} 
            onKeyDown={handleKeyDown}
          />
        )}

        <div className="dialog-actions">
          <button className="dialog-btn cancel" onClick={onCancel}>Cancel</button>
          <button className="dialog-btn confirm" onClick={handleConfirm}>{type === 'prompt' ? 'Save' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
