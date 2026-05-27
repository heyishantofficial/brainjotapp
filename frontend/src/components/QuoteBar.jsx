import React, { useState, useEffect } from 'react';

const QUOTES = [
  "No one is coming to save you.",
  "You're not doing enough, and you know it.",
  "Stop mistaking motion for progress.",
  "If you want to be exceptional, stop acting like everyone else.",
  "Discipline eats motivation for breakfast.",
  "Your potential is meaningless if you don't execute.",
  "The only thing you've consistently delivered is disappointment... until now.",
  "There is no 'later'. Do it now.",
  "Are you building a legacy, or just busy?",
  "Growth happens the second you stop making excuses."
];

export default function QuoteBar() {
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [fadeClass, setFadeClass] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Pick initial quote randomly
    setQuoteIdx(Math.floor(Math.random() * QUOTES.length));

    const cycleId = setInterval(() => {
      setFadeClass('fade-out');
      setTimeout(() => {
        setQuoteIdx(prev => (prev + 1) % QUOTES.length);
        setFadeClass('');
      }, 550);
    }, 15000);
    
    return () => clearInterval(cycleId);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="quote-bar">
      <span className={`quote-text ${fadeClass}`}>{QUOTES[quoteIdx]}</span>
    </div>
  );
}
