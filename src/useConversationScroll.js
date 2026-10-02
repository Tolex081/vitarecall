import { useLayoutEffect, useRef, useState } from 'react';

// Follow replies only while the reader is already at the bottom. Native scroll
// stays in charge while reading older messages; no queued smooth animations.
export function useConversationScroll({ scopeKey, active, lastMessageId, waiting }) {
  const conversationRef = useRef(null);
  const position = useRef({ scopeKey, follow: true, top: 0, active: false, lastMessageId });
  const [hasNewMessages, setHasNewMessages] = useState(false);

  function onScroll(event) {
    const node = event.currentTarget;
    position.current.top = node.scrollTop;
    position.current.follow = node.scrollHeight - node.clientHeight - node.scrollTop < 72;
    if (position.current.follow) setHasNewMessages(false);
  }
  function followNextMessage() { position.current.follow = true; }
  function jumpToLatest() {
    position.current.follow = true;
    const node = conversationRef.current;
    if (node) { node.scrollTop = node.scrollHeight; position.current.top = node.scrollTop; }
    setHasNewMessages(false);
  }

  useLayoutEffect(() => {
    const node = conversationRef.current;
    let state = position.current;
    if (state.scopeKey !== scopeKey) {
      state = position.current = { scopeKey, follow: true, top: 0, active: false, lastMessageId: null };
      setHasNewMessages(false);
    }
    if (!active || !node) { state.active = false; return; }
    if (!lastMessageId && !waiting) {
      state.follow = true;
      state.top = 0;
      setHasNewMessages(false);
    }
    if (state.follow) {
      node.scrollTop = node.scrollHeight;
      state.top = node.scrollTop;
      setHasNewMessages(false);
    } else {
      if (!state.active) node.scrollTop = state.top;
      if (lastMessageId && lastMessageId !== state.lastMessageId) setHasNewMessages(true);
    }
    state.lastMessageId = lastMessageId;
    state.active = true;
  }, [scopeKey, active, lastMessageId, waiting]);

  return { conversationRef, onScroll, followNextMessage, jumpToLatest, hasNewMessages };
}
