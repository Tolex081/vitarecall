import { memo } from 'react';

// Small, deliberately non-HTML renderer. Model text never becomes innerHTML,
// executable code, embedded media, or an unvalidated link.
const inline = text => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
// Reuse already-formatted replies while the user types or receipts poll.
export default memo(function MessageText({ text }) {
  return <div className="message-text rich-message">{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n');
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>;
    if (lines.every(line => /^\s*\d+[.)]\s+/.test(line))) return <ol key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>)}</ol>;
    if (lines.length === 1 && /^#{1,6}\s+/.test(block)) return <h4 key={index}>{inline(block.replace(/^#{1,6}\s+/, ''))}</h4>;
    return <p key={index}>{inline(block)}</p>;
  })}</div>;
});
