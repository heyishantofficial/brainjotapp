import React from 'react';
import { useEscapeClose } from '../utils/hooks';

export default function Lightbox({ url, onClose }) {
  useEscapeClose(onClose);
  return (
    <div className="lightbox open" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>✕</button>
      <img src={url} alt="Lightbox view" onClick={e => e.stopPropagation()} />
    </div>
  );
}
